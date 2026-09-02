"""Score real capture folders, save audit artifacts, and build a map payload.

Example:

    python tools/run_capture_set.py photos/session2

The script intentionally reports only what it can measure from the input:
camera metadata, GPS coverage, time grouping, pairwise image matches, and
street snapping where GPS exists.
"""

from __future__ import annotations

import argparse
import csv
import itertools
import json
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from smc import geo  # noqa: E402
from smc.adapters.free import BoundingBox, OverpassClient, _get  # noqa: E402
from smc.ingest.glasses_sim import (  # noqa: E402
    DegradationConfig,
    DeliveryMode,
    degrade,
    estimated_fov_deg,
)
from smc.ingest.photos import discover_photos, load_photo  # noqa: E402
from smc.mapping.features import FeatureConfig, detect, match_features  # noqa: E402
from smc.overlay.street import StreetMap, StreetSegment  # noqa: E402

CLUSTER_RADIUS_M = 25.0
CLUSTER_WINDOW_S = 45 * 60
USABLE_INLIERS = 15


@dataclass(frozen=True, slots=True)
class Frame:
    path: Path
    lat: float | None
    lon: float | None
    at: float | None
    focal35: float | None
    camera: str
    width: int
    height: int
    landscape: bool


def _input_paths_and_metadata(directory: Path) -> tuple[list[Path], dict[Path, dict[str, object]]]:
    """Support ordinary photo folders and archived batches with manifest metadata."""

    manifest_path = directory / "manifest.json"
    image_dir = directory / "images"
    if manifest_path.exists() and image_dir.exists():
        manifest = json.loads(manifest_path.read_text())
        metadata: dict[Path, dict[str, object]] = {}
        paths: list[Path] = []
        for record in manifest.get("records", []):
            image_path = directory / str(record["archived_image"])
            paths.append(image_path)
            metadata[image_path] = record
        return paths, metadata
    return discover_photos(directory), {}


def load(directory: Path, limit: int | None) -> tuple[list[Frame], list[dict[str, str]]]:
    frames: list[Frame] = []
    unreadable: list[dict[str, str]] = []
    paths, sidecar = _input_paths_and_metadata(directory)
    if limit:
        paths = paths[:limit]

    for path in paths:
        try:
            _, meta = load_photo(path, max_width=96)
        except Exception as exc:
            print(f" unreadable: {path.name} ({type(exc).__name__})")
            unreadable.append(
                {"file": path.name, "path": str(path), "error": type(exc).__name__}
            )
            continue

        record = sidecar.get(path, {})
        lat = record.get("lat", meta.lat)
        lon = record.get("lon", meta.lon)
        captured_at = record.get("captured_at")
        at = meta.captured_at.timestamp() if meta.captured_at else None
        if captured_at:
            from datetime import datetime

            at = datetime.fromisoformat(str(captured_at)).timestamp()
        focal35 = record.get("focal_35mm", meta.focal_35mm)
        width = int(record.get("width") or meta.width)
        height = int(record.get("height") or meta.height)

        frames.append(
            Frame(
                path=path,
                lat=float(lat) if lat is not None else None,
                lon=float(lon) if lon is not None else None,
                at=at,
                focal35=float(focal35) if focal35 is not None else None,
                camera=str(record.get("camera") or meta.camera),
                width=width,
                height=height,
                landscape=width > height,
            )
        )
    return frames, unreadable


def cluster(frames: list[Frame]) -> dict[str, list[Frame]]:
    """Group places by GPS when available, otherwise by capture time."""

    groups: dict[str, list[Frame]] = defaultdict(list)
    anchors: list[tuple[float, float, float, str]] = []
    ordered = sorted(frames, key=lambda f: f.at or 0.0)

    for frame in ordered:
        if frame.lat is not None and frame.at is not None:
            name = next(
                (
                    label
                    for lat, lon, when, label in anchors
                    if geo.distance_m(frame.lat, frame.lon, lat, lon) <= CLUSTER_RADIUS_M
                    and abs(frame.at - when) <= CLUSTER_WINDOW_S
                ),
                None,
            )
            if name is None:
                name = f"place{len(anchors) + 1:02d}"
                anchors.append((frame.lat, frame.lon, frame.at, name))
        else:
            name = "unplaced"
            previous = groups[name][-1].at if groups[name] else None
            if previous and frame.at and frame.at - previous > 180:
                name = f"unplaced{len(groups) + 1:02d}"
        groups[name].append(frame)
    return dict(groups)


def match_within(
    groups: dict[str, list[Frame]], as_glasses: bool, config: FeatureConfig
) -> tuple[list[dict[str, object]], list[int]]:
    """All-pairs matching inside each group. Returns pair rows and feature counts."""

    features: dict[Path, object] = {}
    counts: list[int] = []
    for group in groups.values():
        for frame in group:
            if frame.path in features:
                continue
            image, _ = load_photo(frame.path)
            if as_glasses:
                image, _ = degrade(image, DegradationConfig(mode=DeliveryMode.PHOTO))
            found = detect(image, config)
            features[frame.path] = found
            counts.append(len(found))

    pairs: list[dict[str, object]] = []
    for name, group in groups.items():
        for a, b in itertools.combinations(group, 2):
            idx, _ = match_features(features[a.path], features[b.path], config)
            gap = abs((a.at or 0) - (b.at or 0))
            distance = (
                geo.distance_m(a.lat, a.lon, b.lat, b.lon)
                if a.lat is not None and b.lat is not None
                else None
            )
            pairs.append(
                {
                    "group": name,
                    "a": a.path.name,
                    "b": b.path.name,
                    "inliers": len(idx),
                    "usable": len(idx) >= USABLE_INLIERS,
                    "gap_s": gap,
                    "distance_m": distance,
                    "a_focal35": a.focal35,
                    "b_focal35": b.focal35,
                    "a_orientation": "landscape" if a.landscape else "portrait",
                    "b_orientation": "landscape" if b.landscape else "portrait",
                }
            )
    return pairs, counts


def fetch_streets(lat: float, lon: float, radius_m: float) -> dict[str, object]:
    client = OverpassClient()
    bbox = BoundingBox.around(lat, lon, radius_m)
    area = f"{bbox.south},{bbox.west},{bbox.north},{bbox.east}"
    roads = _get(
        f"{client.PUBLIC_ENDPOINT}?data="
        + f'[out:json][timeout:60];(way["highway"]({area}););out geom;'.replace(
            " ", "%20"
        )
    )
    client._throttle()  # noqa: SLF001
    walks = client.fetch(bbox)
    return {"roads": roads, "walks": walks, "bbox": bbox}


def to_lines(payload: dict[str, object], classify) -> list[dict[str, object]]:
    out: list[dict[str, object]] = []
    for element in payload.get("elements", []):  # type: ignore[union-attr]
        if element.get("type") != "way" or not element.get("geometry"):
            continue
        kind = classify(element.get("tags", {}))
        if kind is None:
            continue
        line = [[round(p["lon"], 5), round(p["lat"], 5)] for p in element["geometry"]]
        if len(line) >= 2:
            out.append({"k": kind, "g": line})
    return out


def write_csv(path: Path, rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        path.write_text("")
        return
    with path.open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def write_thumbnails(frames: list[Frame], audit_dir: Path, *, max_count: int = 24) -> list[dict]:
    """Write small JPEG thumbnails for audit and map strip use."""

    from PIL import Image

    thumb_dir = audit_dir / "thumbs"
    thumb_dir.mkdir(parents=True, exist_ok=True)
    if not frames:
        return []

    step = max(1, len(frames) // max_count)
    photos: list[dict[str, object]] = []
    for frame in frames[::step][:max_count]:
        image, meta = load_photo(frame.path, max_width=260)
        out = thumb_dir / f"{frame.path.stem}.jpg"
        Image.fromarray(image).save(out, "JPEG", quality=72, optimize=True)
        photos.append(
            {
                "n": frame.path.name,
                "t": meta.captured_at.strftime("%H:%M:%S") if meta.captured_at else "",
                "src": str(out.relative_to(audit_dir.parent)),
                "lon": frame.lon,
                "lat": frame.lat,
            }
        )
    return photos


def summarize_pairs(label: str, pairs: list[dict[str, object]], counts: list[int]) -> dict:
    if not pairs:
        print(f" {label}: no pairs (each place has one frame)")
        return {"pairs": 0, "usable_pairs": 0, "usable_rate": 0.0}

    inliers = np.array([p["inliers"] for p in pairs], dtype=np.float64)
    usable = inliers >= USABLE_INLIERS
    print(f" {label}:")
    print(f" {len(pairs)} pairs, median {np.median(counts):.0f} features/frame")
    print(f" usable (>={USABLE_INLIERS} inliers): {usable.sum()} ({100 * usable.mean():.0f}%)")
    print(
        f" inliers: median {np.median(inliers):.0f}, "
        f"p90 {np.percentile(inliers, 90):.0f}, max {inliers.max():.0f}"
    )
    near = inliers[[p["gap_s"] <= 20 for p in pairs]]
    if len(near):
        print(
            f" within 20 s each other: {len(near)} pairs, "
            f"{100 * np.mean(near >= USABLE_INLIERS):.0f}% usable"
        )
    return {
        "pairs": len(pairs),
        "usable_pairs": int(usable.sum()),
        "usable_rate": float(usable.mean()),
        "median_inliers": float(np.median(inliers)),
        "p90_inliers": float(np.percentile(inliers, 90)),
        "max_inliers": int(inliers.max()),
        "median_features_per_frame": float(np.median(counts)) if counts else 0.0,
    }


def main() -> int:
    parser = argparse.ArgumentParser(prog="run_capture_set")
    parser.add_argument("directory", type=Path)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--out", type=Path, default=Path("build/session_map.json"))
    parser.add_argument("--audit-dir", type=Path)
    parser.add_argument("--no-network", action="store_true", help="skip street fetch")
    args = parser.parse_args()

    audit_dir = args.audit_dir or args.out.with_suffix("")
    frames, unreadable = load(args.directory, args.limit)
    audit_dir.mkdir(parents=True, exist_ok=True)
    write_csv(audit_dir / "unreadable.csv", unreadable)

    if not frames:
        print(f"No readable photographs in {args.directory}")
        (audit_dir / "summary.json").write_text(
            json.dumps(
                {
                    "source": str(args.directory),
                    "frames": 0,
                    "unreadable": len(unreadable),
                },
                indent=2,
            )
        )
        return 1

    print(f"=== {len(frames)} photographs ===")
    cameras = Counter(f.camera for f in frames)
    print(f" camera: {cameras.most_common(1)[0][0] or 'unknown'}")
    focals = Counter(f.focal35 for f in frames if f.focal35)
    for focal, n in focals.most_common(3):
        fov = estimated_fov_deg(focal)
        print(f" focal: {focal:.0f} mm eq -> {fov:.0f} deg horizontal ({n} frames)")
    landscape = sum(1 for f in frames if f.landscape)
    print(f" orientation: {landscape} landscape, {len(frames) - landscape} portrait")
    placed = [f for f in frames if f.lat is not None]
    print(f" position: {len(placed)} of {len(frames)} carry GPS")
    timed = sum(1 for f in frames if f.at)
    print(f" time: {timed} of {len(frames)} carry a capture time")

    if not placed:
        print("\n No GPS on any frame. They cannot be placed on map; matching still runs.")

    groups = cluster(frames)
    print(f"\n=== {len(groups)} place(s) ===")
    for name, group in sorted(groups.items()):
        print(f" {name:<12} {len(group)} frames")

    frame_rows = [
        {
            "file": f.path.name,
            "path": str(f.path),
            "group": name,
            "lat": f.lat,
            "lon": f.lon,
            "has_gps": f.lat is not None,
            "captured_at_epoch": f.at,
            "camera": f.camera,
            "focal35": f.focal35,
            "width": f.width,
            "height": f.height,
            "orientation": "landscape" if f.landscape else "portrait",
        }
        for name, group in sorted(groups.items())
        for f in group
    ]
    write_csv(audit_dir / "frames.csv", frame_rows)

    config = FeatureConfig(max_features=4000, contrast_threshold=0.008)
    print("\n=== matching ===")
    all_pair_rows: list[dict[str, object]] = []
    match_summary: dict[str, dict] = {}
    for label, as_glasses in (("full resolution", False), ("as glasses deliver", True)):
        pairs, counts = match_within(groups, as_glasses, config)
        match_summary[label] = summarize_pairs(label, pairs, counts)
        mode = "glasses" if as_glasses else "full"
        all_pair_rows.extend({"mode": mode, **p} for p in pairs)
    write_csv(audit_dir / "pairs.csv", all_pair_rows)

    group_rows: list[dict[str, object]] = []
    for name, group in sorted(groups.items()):
        for mode in ("full", "glasses"):
            pairs = [p for p in all_pair_rows if p["mode"] == mode and p["group"] == name]
            if not pairs:
                continue
            inliers = np.array([p["inliers"] for p in pairs], dtype=np.float64)
            group_rows.append(
                {
                    "group": name,
                    "mode": mode,
                    "frames": len(group),
                    "pairs": len(pairs),
                    "usable_pairs": int((inliers >= USABLE_INLIERS).sum()),
                    "usable_rate": float(np.mean(inliers >= USABLE_INLIERS)),
                    "median_inliers": float(np.median(inliers)),
                    "max_inliers": int(inliers.max()),
                }
            )
    write_csv(audit_dir / "groups.csv", group_rows)
    photos = write_thumbnails(frames, audit_dir)

    roads: list[dict[str, object]] = []
    walks: list[dict[str, object]] = []
    bbox_list = [0.0, 0.0, 0.0, 0.0]
    centre = {"lat": None, "lon": None}
    snapped_points: list[dict[str, object]] = []
    if placed and not args.no_network:
        centre_lat = float(np.median([f.lat for f in placed]))
        centre_lon = float(np.median([f.lon for f in placed]))
        spread = max(
            (geo.distance_m(centre_lat, centre_lon, f.lat, f.lon) for f in placed),
            default=0.0,
        )
        radius = max(250.0, min(spread * 1.4 + 150.0, 1500.0))
        print("\n=== map ===")
        print(f" centre {centre_lat:.5f}, {centre_lon:.5f} spread {spread:.0f} m")
        print(f" fetching streets within {radius:.0f} m...")
        data = fetch_streets(centre_lat, centre_lon, radius)
        roads = to_lines(data["roads"], lambda t: "road" if t.get("highway") else None)
        walks = to_lines(
            data["walks"],
            lambda t: "crossing"
            if t.get("footway") == "crossing"
            else (
                "sidewalk"
                if t.get("footway") == "sidewalk" or t.get("highway") == "footway"
                else None
            ),
        )
        print(f" {len(roads)} roads, {len(walks)} footways crossings")

        origin = geo.Origin(centre_lat, centre_lon)
        segments = [
            StreetSegment(
                f"osm{i}",
                np.array([geo.geodetic_to_enu(origin, p[1], p[0]) for p in w["g"]]),
            )
            for i, w in enumerate(roads)
            if len(w["g"]) >= 2
        ]
        street = StreetMap(origin, segments)
        for f in placed:
            snap = street.snap(f.lat, f.lon, max_distance_m=40.0)
            if snap:
                snapped_points.append(
                    {
                        "lon": f.lon,
                        "lat": f.lat,
                        "file": f.path.name,
                        "feature_id": snap.feature_id,
                    }
                )
        print(f" snapped to a street: {len(snapped_points)} of {len(placed)}")
        bbox = data["bbox"]
        bbox_list = [bbox.west, bbox.south, bbox.east, bbox.north]
        centre = {"lat": centre_lat, "lon": centre_lon}

    session_points = [{"lon": f.lon, "lat": f.lat, "file": f.path.name} for f in placed]
    summary = {
        "source": str(args.directory),
        "frames": len(frames),
        "unreadable": len(unreadable),
        "gps_frames": len(placed),
        "timed_frames": timed,
        "groups": {name: len(group) for name, group in sorted(groups.items())},
        "matching": match_summary,
        "snapped_frames": len(snapped_points),
        "audit_dir": str(audit_dir),
    }
    (audit_dir / "summary.json").write_text(json.dumps(summary, indent=2))

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(
            {
                "centre": centre,
                "bbox": bbox_list,
                "roads": roads,
                "pedestrian": walks,
                "coverage": [],
                "session": {
                    "frames": len(frames),
                    "points": session_points,
                    "snapped": snapped_points,
                    "photos": photos,
                    "audit": {
                        "summary": str((audit_dir / "summary.json").relative_to(args.out.parent)),
                        "frames": str((audit_dir / "frames.csv").relative_to(args.out.parent)),
                        "pairs": str((audit_dir / "pairs.csv").relative_to(args.out.parent)),
                        "groups": str((audit_dir / "groups.csv").relative_to(args.out.parent)),
                    },
                },
            },
            separators=(",", ":"),
        )
    )
    print(f" wrote {args.out}")
    print(f" wrote audit artifacts in {audit_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
