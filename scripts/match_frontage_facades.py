#!/usr/bin/env python3
"""Fit retained front photographs into private, provenance-bound visual specifications.

Continuously watches the filter's photo bucket (its review output). With --auto-accept every
fit is decided automatically (smc.facades.auto_review) into a bucket per house, and the accepted
ones are published as parameters; raw photographs never enter public output here. Passes move
forward: a house already decided is kept as it is (settled_houses) unless --refit-all.

A house photographed more than once is reconstructed from all its views together
(smc.facades.multiview): its windows and doors followed from view to view and each read from the
view that sees it best, its dimensions from all of them, and its stair's direction and size and
its alcove's depth from how they move between views. When it is fitted -- and, for a house
already decided and accepted, when a new photograph of it arrives (with_multiview_upgrades):
new evidence moves it forward; nothing is redone without it.
"""

from __future__ import annotations

import argparse
import copy
import fcntl
import hashlib
import html
import json
import os
import sys
import time
from collections import Counter
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from smc.facades.version import implementation_sha256  # noqa: E402

LOADED_IMPLEMENTATION = implementation_sha256(ROOT)

from smc.facades.architecture_logic import (  # noqa: E402
    NeighbourIndex,
    front_footprint_frame,
    nearby_entry_pattern,
)
from smc.facades.auto_review import accepted as auto_accepted  # noqa: E402
from smc.facades.auto_review import decide  # noqa: E402
from smc.facades.consensus import (  # noqa: E402
    certainty,
    cross_view,
    neighbourhood_reference,
    strict_view_gate,
)
from smc.facades import multiview  # noqa: E402
from smc.facades.detail_detection import FacadeDetailDetector  # noqa: E402
from smc.facades.fit import extract_front, opening_design  # noqa: E402
from smc.facades.frontage_retention import prune_finalized, retained_fact  # noqa: E402
from smc.facades.geometry import LocalFrame  # noqa: E402
from smc.facades.view_store import ViewStore  # noqa: E402


def atomic(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w") as stream:
        json.dump(data, stream, indent=2, default=str)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def diagram(fit: dict) -> str:
    width, height = fit["width_m"], fit["height_m"]
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}">',
        f'<rect width="{width}" height="{height}" fill="{fit["appearance"]["colour"] or "#b9b4a8"}"/>',
    ]
    for band in fit["appearance"].get("bands", []):
        if band.get("colour"):
            colour = html.escape(band["colour"], quote=True)
            out.append(
                f'<rect y="{height - band["top_m"]}" width="{width}" '
                f'height="{band["top_m"] - band["bottom_m"]}" fill="{colour}"/>'
            )
    for o in fit["openings"]:
        x, y, w, h = o["u"], height - o["v"] - o["h"], o["w"], o["h"]
        fill = "#26333b" if o["kind"] == "window" else "#5b4632"
        trim = html.escape(o["design"].get("trim", {}).get("colour", "#626568"), quote=True)
        out.append(
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{fill}" stroke="{trim}" stroke-width=".06"/>'
        )
        for v in o["design"]["vertical_bars"]:
            out.append(f'<path d="M{x + w * v},{y} v{h}" stroke="{trim}" stroke-width=".035"/>')
        for v in o["design"]["horizontal_bars"]:
            out.append(f'<path d="M{x},{y + h * v} h{w}" stroke="{trim}" stroke-width=".035"/>')
    return "".join(out) + "</svg>"


def settled_houses(output: Path) -> dict:
    """Every house already decided: its bucket record, by (region, building id).

    A house in ``houses/`` or ``rejected/`` is finished. Later passes move forward: they fit new
    buildings, and a new photograph of a finished house only where it ranks better than the one
    the house was decided on. Nothing finished is refitted, re-decided or rewritten -- not when the
    code changes either -- unless the matcher is run with ``--refit-all``.
    """
    settled = {}
    for bucket in ("houses", "rejected"):
        for path in sorted((output / bucket).glob("*/*.json")):
            try:
                record = json.loads(path.read_text())
            except (OSError, ValueError):
                continue
            if isinstance(record, dict) and record.get("building_id") and record.get("fit_rank") is not None:
                settled[(path.parent.name, str(record["building_id"]))] = {
                    "bucket": bucket, "record": record, "image_sha256": record.get("image_sha256"),
                    "fit_rank": record["fit_rank"]}
    return settled


def _view_manifest(output: Path, region: str, key: str) -> dict | None:
    try:
        return json.loads((output / "views" / region / key / "manifest.json").read_text())
    except (OSError, ValueError):
        return None


def with_multiview(output: Path, fit: dict, region: str, key: str, reference_key: str | None) -> dict:
    """The fit with what all the house's filed views say together (smc.facades.multiview).

    The reconstruction is kept per set of views (``multiview/``), so a pass with nothing new for
    a house costs it nothing.
    """
    manifest = _view_manifest(output, region, key)
    if not manifest:
        return fit
    count = len(manifest.get("views", []))
    if count < 2:
        fit["multiview_reconstruction"] = {"schema": multiview.SCHEMA, "status": "single_view", "views_filed": count}
        return fit
    openings = [{k: o.get(k) for k in ("id", "kind", "u", "v", "w", "h")} for o in fit.get("openings") or []
                if o.get("kind") in {"window", "door"}]
    signature = hashlib.sha256(json.dumps({
        "views": sorted(v["key"] for v in manifest["views"]), "reference": reference_key,
        "openings": openings, "schema": multiview.SCHEMA}, sort_keys=True).encode()).hexdigest()[:16]
    cache = output / "multiview" / region / f"{key}-{signature}.json"
    folder = output / "views" / region / key
    views = multiview.load_views(folder, manifest)
    if cache.exists():
        result = json.loads(cache.read_text())
    else:
        result = multiview.reconstruct(views, reference_key, openings)
        atomic(cache, result)
    fit = multiview.apply_to_fit(fit, result, views, design=opening_design)
    fit.setdefault("multiview_reconstruction", {"schema": multiview.SCHEMA, "status": result.get("status")})
    fit["multiview_reconstruction"]["views_filed"] = count
    return fit


def with_multiview_upgrades(args, builds: dict, reused: set[str]) -> int:
    """Accepted houses kept from earlier passes that have been photographed again since.

    A house is kept as it was decided -- this only looks at the ones with more views filed than
    when it was decided (or, for a house decided before multiview, than when multiview first saw
    it: ``multiview-baseline.json``), and lays what the views together say over the house's
    record. Rejected houses stay as they were decided.
    """
    baseline_path = args.output / "multiview-baseline.json"
    try:
        baseline = json.loads(baseline_path.read_text())
    except (OSError, ValueError):
        baseline = {}
    upgraded = 0
    for key in sorted(reused):
        record = builds.get(key)
        region = (record or {}).get("region")
        house = args.output / "houses" / str(region) / f"{key}.json"
        if not record or not region or not house.exists():
            continue
        manifest = _view_manifest(args.output, region, key)
        count = len((manifest or {}).get("views", []))
        tag = f"{region}:{key}"
        known = (record.get("multiview_reconstruction") or {}).get("views_filed") or baseline.get(tag)
        if known is None:
            baseline[tag] = count
            continue
        if count <= known or count < 2:
            continue
        reference = next((v["key"] for v in manifest["views"]
                          if v.get("observation_uid") == record.get("observation_uid")), None)
        try:
            fresh = with_multiview(args.output, copy.deepcopy(record), region, key, reference)
        except (OSError, ValueError, KeyError, cv2.error) as error:
            print(json.dumps({"multiview_failed": tag, "error": type(error).__name__}), flush=True)
            baseline[tag] = count
            continue
        applied = (fresh.get("multiview_reconstruction") or {}).get("applied") or {}
        if any(applied.get(k) for k in ("openings_fused", "openings_resourced", "stair")) or applied.get("alcove") is not None:
            atomic(house, fresh)
            builds[key] = fresh
            upgraded += 1
        baseline[tag] = count
    atomic(baseline_path, baseline)
    return upgraded


def cycle(args) -> dict:
    started = time.perf_counter()
    if implementation_sha256(ROOT) != LOADED_IMPLEMENTATION:
        raise RuntimeError("facade implementation changed; worker restart required")
    controls = json.loads(args.controls.read_text()) if args.controls else {}
    payloads, materials, builds, cards = {}, {}, {}, {}
    finalized_facts = {}
    fit_sources = {}
    views = {}
    failures = []
    held = 0
    timings = []
    fitted, rejected = 0, 0
    code_hash = LOADED_IMPLEMENTATION
    settled = {} if getattr(args, "refit_all", False) else settled_houses(args.output)
    reused: set[str] = set()
    # Every screened photograph of a house, filed with the others of it (view_store).
    view_store, views_filed = ViewStore(args.output / "views"), 0
    for review_root in args.inputs:
        for path in sorted((review_root / "review").glob("*.json")):
            row = json.loads(path.read_text())
            if not isinstance(row, dict) or not row.get("building_id"):
                continue
            saved = retained_fact(row)
            if saved:
                # Keep reviewed facts after raw deletion without silently reapproving them.
                finalized_facts[f"{saved['region']}:{saved['building_id']}"] = saved
                continue
            views_filed += view_store.file(row, path)
            if row.get("status") not in {
                "verified",
                "screened_candidate_needs_privacy_and_identity_review",
            }:
                continue
            candidate = row["candidate"]
            gate = strict_view_gate(candidate)
            if not gate["metadata_pass"]:
                held += 1
                continue
            region, key = row["region"], str(row["building_id"])
            done = settled.get((region, key))
            if done and (row.get("pixel_sha256") == done["image_sha256"]
                         or candidate.get("rank") is None or list(candidate["rank"]) <= list(done["fit_rank"])):
                # Finished, and this photograph is no better than the one it was decided on.
                if key not in builds or builds[key]["fit_rank"] < done["fit_rank"]:
                    builds[key] = done["record"]
                    reused.add(key)
                continue
            photo, mask = path.with_suffix(".jpg"), path.with_suffix(".labels.png")
            if not photo.is_file() or not mask.is_file():
                continue
            if region not in payloads:
                model = ROOT / (
                    "docs/sf-corridor-3d.json"
                    if region == "sf-corridor"
                    else f"docs/app-regions/{region}/sf-corridor-3d.json"
                )
                if not model.exists():
                    model = ROOT / f"docs/regions/{region}/sf-corridor-3d.json"
                payload = json.loads(model.read_text())
                payloads[region] = (
                    payload["bbox"],
                    {str(w["osm_id"]): w for w in payload["ways"] if w.get("kind") == "building"},
                    hashlib.sha256(model.read_bytes()).hexdigest(),
                )
                material_path = model.parent / "sf-corridor-materials.json"
                materials[region] = (
                    json.loads(material_path.read_text()).get("assigned", {})
                    if material_path.exists()
                    else {}
                )
            bbox, ways, world_hash = payloads[region]
            way = ways.get(key)
            if not way:
                continue
            image = cv2.imread(str(photo))
            labels = cv2.imread(str(mask), cv2.IMREAD_GRAYSCALE)
            if image is None or labels is None:
                continue
            wall = candidate["wall"]
            supplied = dict(controls.get(key, {}))
            if supplied and supplied.get("image_sha256") != row["pixel_sha256"]:
                supplied = {}  # Controls for another image must never be silently reused.
            supplied["image_sha256"] = row["pixel_sha256"]
            if (row.get("ground_reference") or {}).get("frame") == "relative_to_facade_foot":
                supplied.setdefault("ground_reference", row["ground_reference"])
            detection = None
            view_started = time.perf_counter()
            if args.detector is not None:
                digest = hashlib.sha256(photo.read_bytes()).hexdigest()
                detector_version = hashlib.sha256(
                    json.dumps(args.detector.manifest, sort_keys=True).encode()
                ).hexdigest()[:16]
                detection_path = args.output / "detections" / f"{digest}-{detector_version}.json"
                if detection_path.exists():
                    detection = json.loads(detection_path.read_text())
                else:
                    try:
                        detection = args.detector.detect_front(image)
                    except (ValueError, OSError, RuntimeError) as error:
                        failures.append(
                            {
                                "region": region,
                                "building_id": key,
                                "image_sha256": row["pixel_sha256"],
                                "error_type": type(error).__name__,
                                "stage": "detail_detection",
                            }
                        )
                        continue
                    detection["image_file_sha256"] = digest
                    atomic(detection_path, detection)
                supplied["detector_proposals"] = detection["objects"]
            levels = way.get("levels") or way.get("tags", {}).get("building:levels")
            if levels and str(levels).isdigit():
                supplied.setdefault("levels", int(levels))
            supplied.setdefault("material", materials[region].get(key, {}).get("class", "unknown"))
            # Match the viewer's mapped storefront classification; a dark lower
            # floor or a door/garage detection alone is not evidence of a business.
            supplied.setdefault(
                "ground_floor_business", bool(way.get("shops"))
                or way.get("archetype") in {"retail", "restaurant", "office", "hotel"},
            )
            width = ((wall["b"][0] - wall["a"][0]) ** 2 + (wall["b"][1] - wall["a"][1]) ** 2) ** 0.5
            frame = LocalFrame(
                (bbox["north"] + bbox["south"]) / 2, (bbox["east"] + bbox["west"]) / 2
            )
            try:
                supplied["canonical_front_geometry"] = {
                    "ring": front_footprint_frame(
                        [frame.to_xy(*p) for p in way["points"]], wall["a"], wall["b"], wall["normal"]
                    ),
                    "canonical_world_sha256": world_hash,
                }
            except (ValueError, TypeError):
                failures.append({"region": region, "building_id": key, "stage": "invalid_front_basis"})
                continue
            signature = hashlib.sha256(
                json.dumps(
                    {
                        "implementation": code_hash,
                        "image": hashlib.sha256(photo.read_bytes()).hexdigest(),
                        "mask": hashlib.sha256(mask.read_bytes()).hexdigest(),
                        "width": width,
                        "height": wall["height_m"],
                        "controls": supplied,
                    },
                    sort_keys=True,
                ).encode()
            ).hexdigest()
            fact_cache = args.output / "fact-cache" / f"{signature}.json"
            try:
                if fact_cache.exists():
                    fit = json.loads(fact_cache.read_text())
                else:
                    fit = extract_front(image, labels, width, wall["height_m"], supplied)
                    atomic(fact_cache, fit)
            except (ValueError, KeyError) as error:
                failures.append(
                    {
                        "region": region,
                        "building_id": key,
                        "image_sha256": row["pixel_sha256"],
                        "error_type": type(error).__name__,
                        "stage": "fact_extraction",
                    }
                )
                continue
            timings.append(time.perf_counter() - view_started)
            fit.update(
                {
                    "building_id": key,
                    "region": region,
                    "address": row.get("address"),
                    "a": frame.to_lonlat(*wall["a"]),
                    "b": frame.to_lonlat(*wall["b"]),
                    "front_normal_enu": wall["normal"],
                    "world_sha256": world_hash,
                    "canonical_footprint": way["points"],
                    "image_sha256": row["pixel_sha256"],
                    "height_source": way.get("height_source", "unknown"),
                    "observation_uid": candidate["observation"]["observation_uid"],
                    "attribution": candidate["observation"]["attribution"],
                    "license_id": candidate["observation"]["license_id"],
                    "source_locator": candidate["observation"]["source_locator"],
                    "implementation_sha256": code_hash,
                    "review_status": "needs_visual_alignment_review",
                    "pixel_publication": "forbidden_without_privacy_review",
                    "fit_rank": candidate["rank"],
                    "detector": detection.get("model") if detection else None,
                    "strict_frontage": gate,
                    "selection_evidence": {
                        k: candidate.get(k)
                        for k in (
                            "geometry_pass",
                            "angle_deg",
                            "edge_angle_deg",
                            "full_front_in_frame",
                            "pose_status",
                        )
                    },
                }
            )
            if fit["conflicts"]:
                rejected += 1
                continue
            views.setdefault(key, []).append(fit)
            old = builds.get(key)
            if old and old["fit_rank"] >= fit["fit_rank"]:
                continue
            reused.discard(key)
            builds[key] = fit
            fit_sources[key] = (review_root, path.stem)
            fitted += 1
            args.output.mkdir(parents=True, exist_ok=True)
            atomic(args.output / f"{region}-{key}.json", fit)
            (args.output / f"{region}-{key}.svg").write_text(diagram(fit))
            # Private side-by-side review, linking local evidence rather than republishing it.
            relative_photo = os.path.relpath(photo, args.output)
            address = (row.get("address") or {}).get("formatted") or key
            cards[key] = (
                f"<article><h2>{html.escape(address)}</h2><p>Prior metric placement; not inch-certified. "
                f'{len(fit["openings"])} opening proposals.</p><div class="pair">'
                f'<img src="{html.escape(relative_photo, quote=True)}" alt="Source facade"/>'
                f'<img src="{region}-{key}.svg" alt="Fitted visual front"/></div></article>'
            )
    upgraded = with_multiview_upgrades(args, builds, reused) if getattr(args, "auto_accept", False) else 0
    multiview_houses = 0
    # A pass over a few houses (scripts/refit_window_gaps.py) is decided among the same neighbours
    # as the run's: the run's fits around them are supplied (--neighbours).
    extra = json.loads(args.neighbours.read_text()).get("buildings", {}) if getattr(args, "neighbours", None) else {}
    neighbour_index = NeighbourIndex([*builds.values(), *finalized_facts.values(),
                                      *(fit for key, fit in extra.items() if key not in builds)])
    for key, fit in builds.items():
        if key in reused:
            continue  # finished: left exactly as it was decided
        try:
            fit = builds[key] = with_multiview(args.output, fit, fit["region"], key,
                                               fit_sources.get(key, (None, None))[1])
        except (OSError, ValueError, KeyError, cv2.error) as error:
            failures.append({"region": fit["region"], "building_id": key, "stage": "multiview",
                             "error_type": type(error).__name__})
        multiview_houses += (fit.get("multiview_reconstruction") or {}).get("status") == "multiview"
        fit["multiview"] = cross_view(fit, views[key])
        neighbours = neighbour_index.near(fit)
        fit["neighbourhood_reference"] = neighbourhood_reference(fit, neighbours)
        fit.setdefault("architectural_logic", {})["nearby_entry_pattern"] = nearby_entry_pattern(
            fit, neighbours
        )
        fit["certainty"].update(certainty(fit, fit["strict_frontage"]))
        atomic(args.output / f"{fit['region']}-{key}.json", fit)
    if implementation_sha256(ROOT) != code_hash:
        raise RuntimeError("facade implementation changed during cycle; worker restart required")
    reconstructed = reconstruct(args, builds, reused) if getattr(args, "auto_accept", False) else None
    atomic(
        args.output / "latest.json",
        {
            "schema": "kerbside.facade_fits/1",
            "buildings": builds,
            "finalized_buildings": finalized_facts,
            "note": "Finalized artifacts retain their original implementation and world hashes; not silently reapproved.",
        },
    )
    atomic(
        args.output / "ai-review.json",
        {
            "schema": "kerbside.facade_review_queue/1",
            "automatic_publication": False,
            "items": [
                {
                    "building_id": key,
                    "address": fit.get("address"),
                    "image_sha256": fit["image_sha256"],
                    "source_locator": fit["source_locator"],
                    "reasons": fit["certainty"]["reasons"],
                    "architectural_logic": fit.get("architectural_logic", {}),
                }
                for key, fit in builds.items()
                if fit["certainty"]["ai_review_required"]
            ],
        },
    )
    atomic(args.output / "quarantined-views.json", failures)
    page = (
        '<!doctype html><meta charset="utf-8"><title>Facade alignment audit</title>'
        "<style>body{font:16px system-ui;background:#eee;margin:24px}.pair{display:flex;gap:20px}.pair img{width:45%;max-height:680px;object-fit:contain}article{background:white;padding:18px;margin:20px 0}</style>"
        "<h1>Private photo-to-facade audit</h1><p>Appearance proposals on canonical priors; neither hidden depth nor inch-scale accuracy is certified.</p>"
        + "".join(cards.values())
    )
    (args.output / "index.html").write_text(page)
    if args.publish_reviewed:
        review = json.loads(args.reviews.read_text()) if args.reviews else {}
        accepted = {}
        receipts = {}
        for key in args.publish_reviewed:
            fit = builds.get(key)
            check = review.get(key, {})
            if (
                not fit
                or check.get("image_sha256") != fit["image_sha256"]
                or check.get("implementation_sha256") != fit["implementation_sha256"]
                or not fit["strict_frontage"]["metadata_pass"]
                or not isinstance(check.get("storeys_count"), int)
                or check["storeys_count"] < 2
                or (
                    any(o.get("type_requires_review") for o in fit["openings"])
                    and not check.get("entrances_verified")
                )
                or not check.get("visual_alignment")
                or (fit.get("outcrops") and not check.get("outcrops_verified"))
                or not all(
                    check.get(gate)
                    for gate in (
                        "full_front_visible",
                        "openings_correct",
                        "material_checked",
                        "metric_alignment",
                        "source_rights_checked",
                    )
                )
                or not check.get("reviewer")
                or not all(
                    check.get(gate)
                    for gate in (
                        "render_3d_verified",
                        "higher_accuracy_than_baseline",
                        "certainty_reviewed",
                        "privacy_reviewed",
                    )
                )
                or (
                    any(o.get("recess", {}).get("render_steps") for o in fit["openings"])
                    and not check.get("stairs_verified")
                )
                or (
                    any(d.get("render") for d in fit.get("details", []))
                    and not check.get("details_verified")
                )
                or (fit["appearance"].get("bands") and not check.get("appearance_bands_verified"))
                or (
                    any(o.get("design", {}).get("trim") for o in fit["openings"])
                    and not check.get("window_trim_verified")
                )
            ):
                raise ValueError(f"missing image-bound visual review for {key}")
            fit["review_status"] = "reviewed_inferred_visual_parameters"
            for opening in fit["openings"]:
                if opening.get("type_requires_review"):
                    opening["type_reviewed"] = bool(check.get("entrances_verified"))
            verified_gate = strict_view_gate(
                {
                    **fit["selection_evidence"],
                    "verified": True,
                    "review": {"full_front_visible": True},
                },
                reviewed_storeys=check["storeys_count"],
            )
            fit["strict_frontage"] = verified_gate
            fit["certainty"].update(certainty(fit, verified_gate))
            accepted[key] = fit
            finalized = args.output / "finalized" / f"{fit['region']}-{key}.json"
            atomic(finalized, fit)
            if fit["certainty"]["tier"] == "high":
                review_root, review_key = fit_sources[key]
                receipts.setdefault(review_root, {})[review_key] = {
                    "fact_path": str(finalized.resolve()),
                    "fact_sha256": hashlib.sha256(finalized.read_bytes()).hexdigest(),
                    "render_verified": True,
                    "reviewer": check["reviewer"],
                }
        published_path = ROOT / "docs/sf-corridor-frontage-fits.json"
        previous = json.loads(published_path.read_text()) if published_path.exists() else {}
        if previous and previous.get("schema") != "kerbside.facade_fits/1":
            raise ValueError("unsupported existing facade publication; refusing to overwrite")
        atomic(
            published_path,
            {
                "schema": "kerbside.facade_fits/1",
                "buildings": {**previous.get("buildings", {}), **accepted},
                "note": "Reviewed image-derived visual parameters, not measured canonical geometry; no photographic pixels included.",
            },
        )
        for review_root, entries in receipts.items():
            atomic(
                args.output
                / f"retention-receipts-{hashlib.sha256(str(review_root).encode()).hexdigest()[:16]}.json",
                entries,
            )
            prune_finalized(review_root, entries)
    status = {
        "pid": os.getpid(),
        "fitted_buildings": len(builds),
        "kept_from_earlier_passes": len(reused),
        "views_filed_this_pass": views_filed,
        "fit_proposals": fitted,
        "conflicts_rejected": rejected,
        "watch_seconds": args.watch_seconds,
        "status": "watching" if args.watch_seconds else "complete",
        "stage": "prior_constrained_visual_facade_fitting_not_dense_reconstruction",
        "implementation_sha256": code_hash,
        "doors_blocked_without_stairs": sum(
            o.get("render_allowed") is False for f in builds.values() for o in f["openings"]
        ),
        "repeated_form_pairs": sum(
            len(f.get("architectural_logic", {}).get("repeated_forms", {}).get("pairs", []))
            for f in builds.values()
        ),
        "nearby_reviewed_entry_patterns": sum(
            bool(f.get("architectural_logic", {}).get("nearby_entry_pattern", {}).get("dominant_category"))
            for f in builds.values()
        ),
        "opening_decision_counts": dict(
            Counter(d["class"] for fit in builds.values() for d in fit.get("opening_decisions", []))
        ),
        "quarantined_stair_proposals": sum(
            d.get("source_kind") == "stairs" and d["kind"] == "opening_review_candidate"
            for fit in builds.values()
            for d in fit.get("details", [])
        ),
        "buildings_with_appearance_bands": sum(
            bool(f["appearance"].get("bands")) for f in builds.values()
        ),
        "reviewed_band_materials": sum(
            b.get("material", "unknown") != "unknown"
            for f in builds.values()
            for b in f["appearance"].get("bands", [])
        ),
        "window_trim_candidates": sum(
            bool(o.get("design", {}).get("trim")) for f in builds.values() for o in f["openings"]
        ),
        "held_by_strict_frontage": held,
        "multiview_houses_this_pass": multiview_houses,
        "multiview_upgrades_this_pass": upgraded,
        "reconstruction": reconstructed,
        "quarantined_views": len(failures),
        "elapsed_seconds": round(time.perf_counter() - started, 3),
        "extraction_view_seconds": {
            "count": len(timings),
            "mean": round(sum(timings) / len(timings), 4) if timings else None,
        },
    }
    atomic(args.output / "status.json", status)
    return status


def with_materials(output: Path, buildings: dict) -> dict:
    """The published fits with the cladding read off each house's photographs laid over them
    (scripts/classify_scanned_materials.py), where the fit has none of its own. The houses'
    bucket records are left as they were decided."""
    try:
        read = json.loads((output / "materials.json").read_text())["houses"]
    except (OSError, ValueError, KeyError):
        return buildings
    out = {}
    for key, fit in buildings.items():
        material = read.get(f"{fit.get('region')}:{key}") or {}
        appearance = fit.get("appearance") or {}
        if material.get("class") and appearance.get("material", "unknown") == "unknown":
            fit = {**fit, "appearance": {**appearance, "material": material["class"],
                                         "material_basis": material.get("basis"),
                                         "material_p": material.get("p")}}
        out[key] = fit
    return out


def reconstruct(args, builds: dict, finished: set[str] = frozenset()) -> dict:
    """Decide every fitted house and put it in its bucket; publish the accepted ones.

    ``houses/<region>/<id>.json`` is a house that is reconstructed: its fit, accepted, with the
    reasons. ``rejected/<region>/<id>.json`` is one that is not, with why. The accepted ones go
    into the fits the model draws (docs/sf-corridor-frontage-fits.json); a house a person
    reviewed keeps that review, and one no longer accepted is taken out.
    """
    counts = Counter()
    entries = Counter()
    published = {}
    index = []
    for key, fit in builds.items():
        if key in finished:
            # Decided on an earlier pass: kept as it was, file untouched.
            decision, record = fit["auto_review"], fit
            accept = decision["accept"]
            counts["kept_from_earlier_passes"] += 1
        else:
            decision = decide(fit)
            accept = decision["accept"]
            bucket, other = ("houses", "rejected") if accept else ("rejected", "houses")
            stale = args.output / other / fit["region"] / f"{key}.json"
            if stale.exists():
                stale.unlink()
            record = auto_accepted(fit, decision) if accept else {**fit, "auto_review": decision}
            atomic(args.output / bucket / fit["region"] / f"{key}.json", record)
            counts["decided_this_pass"] += 1
        counts["accepted" if accept else "rejected"] += 1
        for reason in decision["reasons"]:
            counts[f"rejected_because:{reason.split(':')[0]}"] += 1
        if accept:
            published[key] = record
            entry = fit.get("primary_entry") or {}
            entries[f"{entry.get('kind', 'none')}{'+gate' if entry.get('gate') else ''}"] += 1
            index.append({"region": fit["region"], "building_id": key,
                          "address": (fit.get("address") or {}).get("formatted"),
                          "colour": (fit.get("appearance") or {}).get("colour"),
                          "entry": entry.get("kind"), "gate": bool(entry.get("gate")),
                          "windows": sum(o.get("kind") == "window" for o in fit.get("openings", []))})
    atomic(args.output / "houses" / "index.json",
           {"schema": "kerbside.reconstructed_houses/1", "count": len(index),
            "houses": sorted(index, key=lambda r: (r["region"], r["building_id"]))})
    target = args.publish_to
    previous = json.loads(target.read_text()) if target.exists() else {}
    if previous and previous.get("schema") != "kerbside.facade_fits/1":
        raise ValueError("unsupported existing facade publication; refusing to overwrite")
    reviewed = {k: v for k, v in (previous.get("buildings") or {}).items()
                if v.get("review_status") == "reviewed_inferred_visual_parameters"}
    buildings = with_materials(args.output, {**published, **reviewed})
    if buildings != (previous.get("buildings") or {}):
        atomic(target, {
            "schema": "kerbside.facade_fits/1",
            "buildings": buildings,
            "note": "Image-derived visual parameters on canonical geometry, accepted automatically "
                    "(smc.facades.auto_review) or reviewed; no photographic pixels included.",
        })
    return {"accepted": counts["accepted"], "rejected": counts["rejected"],
            "decided_this_pass": counts["decided_this_pass"],
            "kept_from_earlier_passes": counts["kept_from_earlier_passes"],
            "rejection_reasons": {k.split(":", 1)[1]: v for k, v in counts.items() if k.startswith("rejected_because:")},
            "accepted_entries": dict(entries), "published": len(buildings)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inputs", type=Path, nargs="+", required=True)
    parser.add_argument("--output", type=Path, default=ROOT / "build/facade-match")
    parser.add_argument("--controls", type=Path)
    parser.add_argument("--reviews", type=Path)
    parser.add_argument("--publish-reviewed", nargs="+")
    parser.add_argument("--watch-seconds", type=int, default=0)
    parser.add_argument("--auto-accept", action="store_true",
                        help="decide every fit automatically (auto_review) and publish the accepted")
    parser.add_argument("--publish-to", type=Path, default=ROOT / "docs/sf-corridor-frontage-fits.json")
    parser.add_argument("--refit-all", action="store_true",
                        help="refit and re-decide every house, finished ones included (passes "
                             "otherwise move forward: settled_houses)")
    parser.add_argument("--device", choices=["cpu", "mps", "cuda", "auto"], default="cpu")
    parser.add_argument("--neighbours", type=Path,
                        help="the run's fits around the houses of a partial pass, as its neighbours")
    parser.add_argument(
        "--detail-model-cache",
        type=Path,
        help="optional pinned upstream detector for private proposals",
    )
    args = parser.parse_args()
    if args.watch_seconds < 0 or (args.watch_seconds and args.publish_reviewed):
        parser.error("watching may not automatically publish; nonnegative interval required")
    args.output.mkdir(parents=True, exist_ok=True)
    lock = (args.output / ".worker.lock").open("a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        parser.error("a facade matcher already owns this output")
    atomic(
        args.output / "status.json",
        {"pid": os.getpid(), "status": "initialising_model", "watch_seconds": args.watch_seconds},
    )
    args.detector = (
        FacadeDetailDetector(args.detail_model_cache, device=args.device)
        if args.detail_model_cache
        else None
    )
    source_hash = LOADED_IMPLEMENTATION
    while True:
        try:
            atomic(
                args.output / "status.json",
                {
                    "pid": os.getpid(),
                    "status": "matching_private_evidence",
                    "watch_seconds": args.watch_seconds,
                },
            )
            print(json.dumps(cycle(args)), flush=True)
        except (OSError, ValueError, KeyError) as error:
            atomic(
                args.output / "status.json",
                {"pid": os.getpid(), "status": "retryable_failure", "error": str(error)},
            )
            if not args.watch_seconds:
                raise
        if not args.watch_seconds:
            break
        time.sleep(args.watch_seconds)
        if implementation_sha256(ROOT) != source_hash:
            atomic(
                args.output / "status.json",
                {"pid": os.getpid(), "status": "stopped_code_changed_restart_required"},
            )
            break
