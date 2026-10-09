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
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from smc.facades.fit import extract_front  # noqa: E402
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
    for o in fit["openings"]:
        x, y, w, h = o["u"], height - o["v"] - o["h"], o["w"], o["h"]
        fill = "#26333b" if o["kind"] == "window" else "#5b4632"
        out.append(
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{fill}" stroke="#626568" stroke-width=".06"/>'
        )
        for v in o["design"]["vertical_bars"]:
            out.append(f'<path d="M{x + w * v},{y} v{h}" stroke="#b9b6ad" stroke-width=".035"/>')
        for v in o["design"]["horizontal_bars"]:
            out.append(f'<path d="M{x},{y + h * v} h{w}" stroke="#b9b6ad" stroke-width=".035"/>')
    return "".join(out) + "</svg>"


def cycle(args) -> dict:
    controls = json.loads(args.controls.read_text()) if args.controls else {}
    payloads, materials, builds, cards = {}, {}, {}, []
    fitted, rejected = 0, 0
    code_hash = hashlib.sha256((ROOT / "src/smc/facades/fit.py").read_bytes()).hexdigest()
    for review_root in args.inputs:
        for path in sorted((review_root / "review").glob("*.json")):
            row = json.loads(path.read_text())
            if not isinstance(row, dict) or not row.get("building_id"):
                continue
            if row.get("status") not in {
                "verified",
                "screened_candidate_needs_privacy_and_identity_review",
            }:
                continue
            candidate = row["candidate"]
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
            levels = way.get("levels") or way.get("tags", {}).get("building:levels")
            if levels and str(levels).isdigit():
                supplied.setdefault("levels", int(levels))
            supplied.setdefault("material", materials[region].get(key, {}).get("class", "unknown"))
            width = ((wall["b"][0] - wall["a"][0]) ** 2 + (wall["b"][1] - wall["a"][1]) ** 2) ** 0.5
            fit = extract_front(image, labels, width, wall["height_m"], supplied)
            frame = LocalFrame(
                (bbox["north"] + bbox["south"]) / 2, (bbox["east"] + bbox["west"]) / 2
            )
            fit.update(
                {
                    "building_id": key,
                    "region": region,
                    "address": row.get("address"),
                    "a": frame.to_lonlat(*wall["a"]),
                    "b": frame.to_lonlat(*wall["b"]),
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
                }
            )
            if fit["conflicts"]:
                rejected += 1
                continue
            old = builds.get(key)
            if old and old["fit_rank"] >= fit["fit_rank"]:
                continue
            builds[key] = fit
            fitted += 1
            args.output.mkdir(parents=True, exist_ok=True)
            atomic(args.output / f"{region}-{key}.json", fit)
            (args.output / f"{region}-{key}.svg").write_text(diagram(fit))
            # Private side-by-side review, linking local evidence rather than republishing it.
            relative_photo = os.path.relpath(photo, args.output)
            address = (row.get("address") or {}).get("formatted") or key
            cards.append(
                f"<article><h2>{html.escape(address)}</h2><p>Prior metric placement; not inch-certified. "
                f'{len(fit["openings"])} opening proposals.</p><div class="pair">'
                f'<img src="{html.escape(relative_photo, quote=True)}" alt="Source facade"/>'
                f'<img src="{region}-{key}.svg" alt="Fitted visual front"/></div></article>'
            )
    atomic(args.output / "latest.json", {"schema": "kerbside.facade_fits/1", "buildings": builds})
    page = (
        '<!doctype html><meta charset="utf-8"><title>Facade alignment audit</title>'
        "<style>body{font:16px system-ui;background:#eee;margin:24px}.pair{display:flex;gap:20px}.pair img{width:45%;max-height:680px;object-fit:contain}article{background:white;padding:18px;margin:20px 0}</style>"
        "<h1>Private photo-to-facade audit</h1><p>Appearance proposals on canonical priors; neither hidden depth nor inch-scale accuracy is certified.</p>"
        + "".join(cards)
    )
    (args.output / "index.html").write_text(page)
    if args.publish_reviewed:
        review = json.loads(args.reviews.read_text()) if args.reviews else {}
        accepted = {}
        for key in args.publish_reviewed:
            fit = builds.get(key)
            check = review.get(key, {})
            if (
                not fit
                or check.get("image_sha256") != fit["image_sha256"]
                or not check.get("visual_alignment")
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
            ):
                raise ValueError(f"missing image-bound visual review for {key}")
            fit["review_status"] = "reviewed_inferred_visual_parameters"
            accepted[key] = fit
        atomic(
            ROOT / "docs/sf-corridor-frontage-fits.json",
            {
                "schema": "kerbside.facade_fits/1",
                "buildings": accepted,
                "note": "Reviewed image-derived visual parameters, not measured canonical geometry; no photographic pixels included.",
            },
        )
    status = {
        "pid": os.getpid(),
        "fitted_buildings": len(builds),
        "fit_proposals": fitted,
        "conflicts_rejected": rejected,
        "watch_seconds": args.watch_seconds,
        "status": "watching" if args.watch_seconds else "complete",
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
    args = parser.parse_args()
    if args.watch_seconds < 0 or (args.watch_seconds and args.publish_reviewed):
        parser.error("watching may not automatically publish; nonnegative interval required")
    args.output.mkdir(parents=True, exist_ok=True)
    lock = (args.output / ".worker.lock").open("a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        parser.error("a facade matcher already owns this output")
    implementation = [Path(__file__), ROOT / "src/smc/facades/fit.py"]
    source_hash = hashlib.sha256(b"".join(p.read_bytes() for p in implementation)).hexdigest()
    while True:
        try:
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
        if (
            hashlib.sha256(b"".join(p.read_bytes() for p in implementation)).hexdigest()
            != source_hash
        ):
            atomic(
                args.output / "status.json",
                {"pid": os.getpid(), "status": "stopped_code_changed_restart_required"},
            )
            break
