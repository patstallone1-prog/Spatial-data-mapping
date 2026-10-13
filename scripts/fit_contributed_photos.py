#!/usr/bin/env python3
"""Fit house fronts from photographs someone took on the pavement, as the run fits its own.

A contributed photograph has no solved camera pose -- a phone's GPS is five to twelve metres out
-- so it is squared up from what it shows (smc.facades.photo_rectify: the front's vertical and
horizontal vanishing points), and the front is cut out of that between the extents marked in the
spec, and scaled by the house's own front wall (its footprint) and height (the lidar). From there
it is the run's pipeline unchanged: the same segmentation (UperNet, ADE20K) and detail detector
(Grounding DINO), the same fit (smc.facades.fit.extract_front) and the same automatic decision
(smc.facades.auto_review). Fits only are written -- parameters, no pixels -- to
``data/contributed_houses/<region>-<id>.json``; tools/tile_frontage_fits.py publishes them with
the run's.

The spec (JSON) lists, per house: ``photo`` (the file), ``building`` (OpenStreetMap id),
``region``, ``extents`` ([left, top, right, bottom] in the squared-up photograph's pixels, as
printed by --square), ``angle_deg`` (how far off square the photo was taken, from its compass
heading against the wall), ``captured_at`` and ``contributor``.

    .venv/bin/python scripts/fit_contributed_photos.py --spec data/contributed_houses/<spec>.json [--square]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from smc.facades.architecture_logic import front_footprint_frame  # noqa: E402
from smc.facades.auto_review import accepted as auto_accepted  # noqa: E402
from smc.facades.auto_review import decide  # noqa: E402
from smc.facades.consensus import certainty, strict_view_gate  # noqa: E402
from smc.facades.fit import extract_front  # noqa: E402
from smc.facades.geometry import LocalFrame, walls_of  # noqa: E402
from smc.facades.photo_rectify import elevation, elevation_matrix, squared_up  # noqa: E402

OUT = ROOT / "data" / "contributed_houses"
PIXELS_PER_M = 35.0
#: The run's model caches (the filter's and the matcher's).
RUN = Path("/Applications/Spatial-data-mapping-returning-visitor-cache/build")


def load_photo(path: Path, max_side: int = 2400) -> np.ndarray:
    from PIL import Image
    try:
        import pillow_heif
        pillow_heif.register_heif_opener()
    except ImportError:
        pass
    image = Image.open(path)
    from PIL import ImageOps
    image = ImageOps.exif_transpose(image).convert("RGB")
    image.thumbnail((max_side, max_side))
    return np.asarray(image)[:, :, ::-1].copy()


def facade_homography(photo: np.ndarray, front: np.ndarray, min_inliers: int = 40) -> np.ndarray | None:
    """The homography laying a photograph of the same front on the front's elevation: SIFT
    features matched and a RANSAC homography (a wall is a plane). None without enough agreement."""
    sift = cv2.SIFT_create(6000)
    grey = lambda im: cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)  # noqa: E731
    kp1, d1 = sift.detectAndCompute(grey(photo), None)
    kp2, d2 = sift.detectAndCompute(grey(front), None)
    if d1 is None or d2 is None:
        return None
    matches = cv2.BFMatcher().knnMatch(d1, d2, k=2)
    good = [m for m, *rest in matches if rest and m.distance < 0.75 * rest[0].distance]
    if len(good) < min_inliers:
        return None
    src = np.float32([kp1[m.queryIdx].pt for m in good])
    dst = np.float32([kp2[m.trainIdx].pt for m in good])
    H, mask = cv2.findHomography(src, dst, cv2.RANSAC, 4.0)
    if H is None or int(mask.sum()) < min_inliers:
        return None
    return H


def apply_corrections(fit: dict, corrections: list[dict], front: np.ndarray, labels: np.ndarray,
                      wall: dict, image_sha256: str) -> None:
    """A reviewer's corrections of what an opening is, from the photographs (the spec says which
    and why): the opening nearest ``at_u`` (metres along the front) at the ground or at ``at_v``
    takes the role, and the entries are read again from the corrected openings. Each is kept in
    the fit (``review_corrections``) with its basis."""
    from smc.facades.entry_inference import infer_entries, primary_entry
    openings = fit.get("openings", [])
    done = []
    for c in [c for c in corrections if c.get("add") == "window"]:
        # A window the fit missed (behind a railing it took for a fire escape): placed in the
        # column of the window at ``like_column`` and the row of the one at ``like_row``.
        windows = [o for o in openings if o["kind"] == "window"]
        col = min(windows, key=lambda o: abs(o["u"] + o["w"] / 2 - c["like_column"]))
        row = min(windows, key=lambda o: abs(o["v"] - c["like_row"]))
        added = {"id": f"opening-reviewed-{len(openings)}", "kind": "window", "role": "window", "role_certainty": "reviewed",
                 "u": col["u"], "w": col["w"], "v": row["v"], "h": row["h"], "confidence": 0.5,
                 "design": dict(row.get("design") or {}), "grade": "reviewer_added_on_contributed_photograph",
                 "role_basis": ["reviewer_correction", c["basis"]], "position_sigma_m": 0.5,
                 "size_anomaly_requires_review": False, "type_requires_review": False}
        openings.append(added)
        done.append({"opening": added["id"], "before": None, "after": {"kind": "window", "role": "window"},
                     "basis": c["basis"], "reviewer": c.get("reviewer", "assistant, on the contributed photographs")})
    corrections = [c for c in corrections if c.get("add") != "window"]
    for c in corrections:
        target = min(openings, key=lambda o: abs(o["u"] + o["w"] / 2 - c["at_u"]) + abs(o["v"] - c.get("at_v", 0.0)))
        before = {"kind": target["kind"], "role": target.get("role")}
        role = c["role"]
        target.update(role=role, role_certainty="reviewed", role_basis=["reviewer_correction", c["basis"]],
                      kind={"entrance": "door", "garage": "garage_candidate", "window": "window"}.get(role, target["kind"]))
        done.append({"opening": target["id"], "before": before, "after": {"kind": target["kind"], "role": role},
                     "basis": c["basis"], "reviewer": c.get("reviewer", "assistant, on the contributed photographs")})
    # A porch wider than one door holds a pair: read as the pair's leaves, 1.8 m, at its middle.
    walkable = [o if o["w"] <= 1.9 else {**o, "u": o["u"] + (o["w"] - 1.8) / 2, "w": 1.8}
                for o in openings if o.get("kind") == "door" and o.get("role") != "garage"]
    gates = [{"u": o["u"], "v": o["v"], "w": o["w"], "h": o["h"]} for o in openings if o["kind"] == "gated_entry_candidate"]
    storey = fit.get("storey_constraint") or {}
    entries = infer_entries(front, labels, wall["length_m"], wall["height_m"], walkable,
                            storey_height_m=storey.get("visual_storey_height_m") or storey.get("storey_height_m"),
                            gate_proposals=gates, image_sha256=image_sha256)
    fit["entries"] = entries
    fit["primary_entry"] = primary_entry(entries)
    fit["review_corrections"] = done


def payload_for(region: str) -> Path:
    if region == "sf-corridor":
        return ROOT / "docs/sf-corridor-3d.json"
    return ROOT / f"docs/regions/{region}/sf-corridor-3d.json"


def front_wall(way: dict, frame: LocalFrame, toward: tuple[float, float]) -> dict:
    """The house's front: its footprint's walls that face the photographer and run along the
    street, as one wall from end to end, ``a`` at the left as seen from the street."""
    ring = [frame.to_xy(*p) for p in way["points"]]
    walls = [w for w in walls_of(ring, float(way.get("height_m") or 10.0), 0, min_length_m=1.0)
             if (toward[0] - w.midpoint[0]) * w.normal[0] + (toward[1] - w.midpoint[1]) * w.normal[1] > 0]
    if not walls:
        raise ValueError("no wall of the footprint faces the photograph")
    main = max(walls, key=lambda w: w.length_m)
    nx, ny = main.normal
    parallel = [w for w in walls if w.normal[0] * nx + w.normal[1] * ny > 0.97]
    # Seen from the street (looking along -normal), left is (ny, -nx).
    lx, ly = ny, -nx
    points = [p for w in parallel for p in (w.a, w.b)]
    a = max(points, key=lambda p: p[0] * lx + p[1] * ly)
    b = min(points, key=lambda p: p[0] * lx + p[1] * ly)
    length = float(np.hypot(b[0] - a[0], b[1] - a[1]))
    # The normal square to the front as a whole (its pieces may bend a hair), on the street's side.
    tx, ty = (b[0] - a[0]) / length, (b[1] - a[1]) / length
    nx2, ny2 = ty, -tx
    if nx2 * nx + ny2 * ny < 0:
        nx2, ny2 = -nx2, -ny2
    return {"a": a, "b": b, "normal": (nx2, ny2), "length_m": length, "height_m": float(way.get("height_m") or 10.0),
            "ring": ring}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--spec", type=Path, required=True)
    ap.add_argument("--square", action="store_true", help="only write the squared-up photographs, to mark extents on")
    ap.add_argument("--work", type=Path, default=ROOT / "build" / "contributed-photos")
    ap.add_argument("--device", default="mps")
    args = ap.parse_args()
    spec = json.loads(args.spec.read_text())
    args.work.mkdir(parents=True, exist_ok=True)
    screen = detector = None
    report = []
    for item in spec["houses"]:
        photo = Path(item["photo"]).expanduser()
        bgr = load_photo(photo)
        square = squared_up(bgr)
        stem = f"{item['region']}-{item['building']}"
        if args.square:
            cv2.imwrite(str(args.work / f"{stem}-square.jpg"), square["image"])
            continue
        payload = json.loads(payload_for(item["region"]).read_text())
        bbox = payload["bbox"]
        frame = LocalFrame((bbox["north"] + bbox["south"]) / 2, (bbox["east"] + bbox["west"]) / 2)
        way = next(w for w in payload["ways"] if w.get("kind") == "building" and str(w.get("osm_id")) == str(item["building"]))
        camera = frame.to_xy(*item["camera_lonlat"])
        wall = front_wall(way, frame, camera)
        front = elevation(bgr, square["H"], tuple(item["extents"]), wall["length_m"], wall["height_m"], PIXELS_PER_M)
        # What the photograph left out (the frame cut a corner of the front), from the others of
        # the same front: each laid on this one by its own features (a plane to a plane is a
        # homography) and used only where this one has nothing.
        filled = []
        to_front, _ = elevation_matrix(square["H"], tuple(item["extents"]), wall["length_m"], wall["height_m"], PIXELS_PER_M)
        for extra in item.get("fill_from", []):
            spec_extra = extra if isinstance(extra, dict) else {"photo": extra}
            other = load_photo(Path(spec_extra["photo"]).expanduser())
            if spec_extra.get("square_points"):
                # Tied by hand: points in the other photograph squared up, and where the same
                # points are on the front (metres along, metres up) -- for a photograph whose
                # features will not match (lights, a railing repeated, a long way round).
                other_square = squared_up(other)
                src = np.float32(spec_extra["square_points"])
                dst = np.float32([[u * PIXELS_PER_M, (wall["height_m"] - v) * PIXELS_PER_M]
                                  for u, v in spec_extra["front_points_m"]])
                A, _ = cv2.estimateAffine2D(src, dst)
                if A is None:
                    continue
                total = np.vstack([A, [0, 0, 1]]) @ other_square["H"]
            else:
                # Matched on the main photograph at its full resolution, then carried to the front.
                H = facade_homography(other, bgr)
                if H is None:
                    continue
                total = to_front @ H
            warped = cv2.warpPerspective(other, total, (front.shape[1], front.shape[0]), flags=cv2.INTER_AREA)
            hole = (front.max(axis=2) == 0) & (warped.max(axis=2) > 0)
            front[hole] = warped[hole]
            filled.append({"photo": Path(spec_extra["photo"]).name, "pixels": int(hole.sum()),
                           "tied": "by_hand" if spec_extra.get("square_points") else "features"})
        visible = front.max(axis=2) > 0
        if screen is None:
            from smc.facades.detail_detection import FacadeDetailDetector
            from smc.facades.frontage_pixels import FrontagePixelScreen
            screen = FrontagePixelScreen(RUN / "frontage-pilot-v2/model-cache", device=args.device)
            detector = FacadeDetailDetector(RUN / "facade-detail-model-cache", device=args.device)
        screened = screen.screen(front, visible)
        labels = screened["labels"].astype(np.uint8)
        detection = detector.detect_front(front)
        cv2.imwrite(str(args.work / f"{stem}-front.jpg"), front)
        cv2.imwrite(str(args.work / f"{stem}-front.labels.png"), labels)
        image_sha256 = hashlib.sha256(photo.read_bytes()).hexdigest()
        controls = {"image_sha256": image_sha256, "detector_proposals": detection["objects"],
                    "material": item.get("material", "unknown"), "ground_floor_business": False,
                    "canonical_front_geometry": {
                        "ring": front_footprint_frame(wall["ring"], wall["a"], wall["b"], wall["normal"]),
                        "canonical_world_sha256": hashlib.sha256(payload_for(item["region"]).read_bytes()).hexdigest()}}
        if item.get("levels"):
            controls["levels"] = int(item["levels"])
        fit = extract_front(front, labels, wall["length_m"], wall["height_m"], controls)
        if item.get("corrections"):
            apply_corrections(fit, item["corrections"], front, labels, wall, image_sha256)
        evidence = {"geometry_pass": True, "angle_deg": item["angle_deg"], "edge_angle_deg": item["angle_deg"],
                    "full_front_in_frame": bool(item.get("full_front_in_frame", True)),
                    "pose_status": "squared_up_from_vanishing_points"}
        gate = strict_view_gate(evidence)
        fit.update({
            "building_id": str(item["building"]), "region": item["region"], "address": way.get("address"),
            "a": frame.to_lonlat(*wall["a"]), "b": frame.to_lonlat(*wall["b"]), "front_normal_enu": wall["normal"],
            "world_sha256": controls["canonical_front_geometry"]["canonical_world_sha256"],
            "canonical_footprint": way["points"], "image_sha256": image_sha256,
            "height_source": way.get("height_source", "unknown"),
            "observation_uid": f"contributed:{image_sha256[:16]}",
            "attribution": f"Photograph by {item['contributor']}, {item['captured_at']}",
            "license_id": "contributed-by-owner", "source_locator": f"contributed://{photo.name}",
            "review_status": "needs_visual_alignment_review", "pixel_publication": "forbidden_without_privacy_review",
            "fit_rank": [1, 1.0], "detector": detection.get("model"), "strict_frontage": gate,
            "selection_evidence": evidence,
            "contributed_photo": {"extents_px": item["extents"], "filled_from": filled, "squared_up": {k: square[k] for k in ("vertical_edges", "horizontal_edges")},
                                  "extents_basis": "marked on the squared-up photograph by the reviewer",
                                  "scale_basis": "front wall from the footprint; height from the lidar"},
        })
        fit["certainty"].update(certainty(fit, gate))
        decision = decide(fit)
        record = auto_accepted(fit, decision) if decision["accept"] else {**fit, "auto_review": decision}
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT / f"{stem}.json").write_text(json.dumps(record, indent=1, default=str) + "\n")
        report.append({"house": stem, "address": (way.get("address") or {}).get("formatted"), "accept": decision["accept"],
                       "reasons": decision["reasons"], "width_m": round(wall["length_m"], 2), "height_m": wall["height_m"],
                       "openings": [o["kind"] for o in fit.get("openings", [])],
                       "entry": (fit.get("primary_entry") or {}).get("kind"), "colour": (fit.get("appearance") or {}).get("colour")})
    print(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
