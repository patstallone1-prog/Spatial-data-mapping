#!/usr/bin/env python3
"""Fit retained front photographs into private, provenance-bound visual specifications.

Continuously watches filter review outputs. Publishing is a separate explicit,
reviewed-parameter action; raw photographs never enter public output here.
"""

from __future__ import annotations

import argparse
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
from smc.facades.consensus import (  # noqa: E402
    certainty,
    cross_view,
    neighbourhood_reference,
    strict_view_gate,
)
from smc.facades.detail_detection import FacadeDetailDetector  # noqa: E402
from smc.facades.fit import extract_front  # noqa: E402
from smc.facades.frontage_retention import prune_finalized, retained_fact  # noqa: E402
from smc.facades.geometry import LocalFrame  # noqa: E402


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
    neighbour_index = NeighbourIndex([*builds.values(), *finalized_facts.values()])
    for key, fit in builds.items():
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
        "quarantined_views": len(failures),
        "elapsed_seconds": round(time.perf_counter() - started, 3),
        "extraction_view_seconds": {
            "count": len(timings),
            "mean": round(sum(timings) / len(timings), 4) if timings else None,
        },
    }
    atomic(args.output / "status.json", status)
    return status


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inputs", type=Path, nargs="+", required=True)
    parser.add_argument("--output", type=Path, default=ROOT / "build/facade-match")
    parser.add_argument("--controls", type=Path)
    parser.add_argument("--reviews", type=Path)
    parser.add_argument("--publish-reviewed", nargs="+")
    parser.add_argument("--watch-seconds", type=int, default=0)
    parser.add_argument("--device", choices=["cpu", "mps", "cuda", "auto"], default="cpu")
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
