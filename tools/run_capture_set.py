"""Score a folder of real captures end to end, and place them on the map.

    python tools/run_capture_set.py photos/session2

Reports what the camera recorded, groups the frames into places, measures how well they match
each other at the resolution the glasses actually deliver, and — where the photographs carry
GPS — snaps them to the street network and writes a map dataset.

Everything here is measurement. Nothing is simulated, and where a number cannot be computed
from the input it is reported as missing rather than estimated.
"""

from __future__ import annotations

import argparse
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

#: Frames within this distance and time are treated as the same place.
CLUSTER_RADIUS_M = 25.0
CLUSTER_WINDOW_S = 45 * 60


@dataclass
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


def load(directory: Path, limit: int | None) -> list[Frame]:
    frames: list[Frame] = []
    paths = discover_photos(directory)
    if limit:
        paths = paths[:limit]
    for path in paths:
        try:
            _, meta = load_photo(path, max_width=96)
        except Exception as exc:  # noqa: BLE001 - a file we cannot open is reported, not fatal
            print(f"  unreadable: {path.name} ({type(exc).__name__})")
            continue
        frames.append(
            Frame(
                path=path,
                lat=meta.lat,
                lon=meta.lon,
                at=meta.captured_at.timestamp() if meta.captured_at else None,
                focal35=meta.focal_35mm,
                camera=meta.camera,
                width=meta.width,
                height=meta.height,
                landscape=meta.width > meta.height,
            )
        )
    return frames


def cluster(frames: list[Frame]) -> dict[str, list[Frame]]:
    """Group into places by position where available, otherwise by time."""
    groups: dict[str, list[Frame]] = defaultdict(list)
    anchors: list[tuple[float, float, float, str]] = []
    ordered = sorted(frames, key=lambda f: f.at or 0.0)

    for frame in ordered:
        if frame.lat is not None and frame.at is not None:
            name = next(
                (
                    label
                    for (lat, lon, when, label) in anchors
                    if geo.distance_m(frame.lat, frame.lon, lat, lon) <= CLUSTER_RADIUS_M
                    and abs(frame.at - when) <= CLUSTER_WINDOW_S
                ),
                None,
            )
            if name is None:
                name = f"place{len(anchors) + 1:02d}"
                anchors.append((frame.lat, frame.lon, frame.at, name))
        else:
            # No position: fall back to a time gap, which is all that is left.
            name = "unplaced"
            if groups[name] and frame.at and groups[name][-1].at:
                if frame.at - groups[name][-1].at > 180:
                    name = f"unplaced{len(groups) + 1:02d}"
        groups[name].append(frame)
    return dict(groups)


def match_within(groups: dict[str, list[Frame]], as_glasses: bool, config: FeatureConfig):
    """All-pairs matching inside each group. Returns (pairs, features per frame)."""
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

    pairs = []
    for name, group in groups.items():
        for a, b in itertools.combinations(group, 2):
            idx, _ = match_features(features[a.path], features[b.path], config)
            gap = abs((a.at or 0) - (b.at or 0))
            distance = (
                geo.distance_m(a.lat, a.lon, b.lat, b.lon)
                if a.lat is not None and b.lat is not None
                else None
            )
            pairs.append({"group": name, "a": a.path.name, "b": b.path.name,
                          "inliers": len(idx), "gap_s": gap, "distance_m": distance})
    return pairs, counts


def fetch_streets(lat: float, lon: float, radius_m: float) -> dict:
    client = OverpassClient()
    bbox = BoundingBox.around(lat, lon, radius_m)
    area = f"{bbox.south},{bbox.west},{bbox.north},{bbox.east}"
    roads = _get(
        f"{client.PUBLIC_ENDPOINT}?data="
        + f'[out:json][timeout:60];(way["highway"]({area}););out geom;'.replace(" ", "%20")
    )
    client._throttle()  # noqa: SLF001
    walks = client.fetch(bbox)
    return {"roads": roads, "walks": walks, "bbox": bbox}


def to_lines(payload: dict, classify) -> list[dict]:
    out = []
    for element in payload.get("elements", []):
        if element.get("type") != "way" or not element.get("geometry"):
            continue
        kind = classify(element.get("tags", {}))
        if kind is None:
            continue
        line = [[round(p["lon"], 5), round(p["lat"], 5)] for p in element["geometry"]]
        if len(line) >= 2:
            out.append({"k": kind, "g": line})
    return out


def main() -> int:
    parser = argparse.ArgumentParser(prog="run_capture_set")
    parser.add_argument("directory", type=Path)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--out", type=Path, default=Path("build/session_map.json"))
    parser.add_argument("--no-network", action="store_true", help="skip the street fetch")
    args = parser.parse_args()

    frames = load(args.directory, args.limit)
    if not frames:
        print(f"No readable photographs in {args.directory}")
        return 1

    print(f"=== {len(frames)} photographs ===")
    cameras = Counter(f.camera for f in frames)
    print(f"  camera:      {cameras.most_common(1)[0][0] or 'unknown'}")
    focals = Counter(f.focal35 for f in frames if f.focal35)
    for focal, n in focals.most_common(3):
        fov = estimated_fov_deg(focal)
        print(f"  focal:       {focal:.0f} mm eq -> {fov:.0f} deg horizontal  ({n} frames)")
    landscape = sum(1 for f in frames if f.landscape)
    print(f"  orientation: {landscape} landscape, {len(frames) - landscape} portrait")
    placed = [f for f in frames if f.lat is not None]
    print(f"  position:    {len(placed)} of {len(frames)} carry GPS")
    timed = sum(1 for f in frames if f.at)
    print(f"  time:        {timed} of {len(frames)} carry a capture time")

    if not placed:
        print("\n  No GPS on any frame. They cannot be placed on the map; matching still runs.")

    groups = cluster(frames)
    print(f"\n=== {len(groups)} place(s) ===")
    for name, group in sorted(groups.items()):
        print(f"  {name:<12} {len(group)} frames")

    config = FeatureConfig(max_features=4000, contrast_threshold=0.008)
    print("\n=== matching ===")
    results = {}
    for label, as_glasses in (("full resolution", False), ("as the glasses deliver", True)):
        pairs, counts = match_within(groups, as_glasses, config)
        if not pairs:
            print(f"  {label}: no pairs (each place has one frame)")
            continue
        inliers = np.array([p["inliers"] for p in pairs])
        usable = inliers >= 15
        print(f"  {label}:")
        print(f"    {len(pairs)} pairs, median {np.median(counts):.0f} features/frame")
        print(f"    usable (>=15 inliers): {usable.sum()} ({100 * usable.mean():.0f}%)")
        print(f"    inliers: median {np.median(inliers):.0f}, p90 {np.percentile(inliers, 90):.0f}, max {inliers.max()}")
        near = inliers[[p["gap_s"] <= 20 for p in pairs]]
        if len(near):
            print(f"    within 20 s of each other: {len(near)} pairs, "
                  f"{100 * np.mean(near >= 15):.0f}% usable")
        results[label] = pairs

    if placed and not args.no_network:
        centre_lat = float(np.median([f.lat for f in placed]))
        centre_lon = float(np.median([f.lon for f in placed]))
        spread = max(
            (geo.distance_m(centre_lat, centre_lon, f.lat, f.lon) for f in placed), default=0.0
        )
        radius = max(250.0, min(spread * 1.4 + 150.0, 1500.0))
        print(f"\n=== map ===")
        print(f"  centre {centre_lat:.5f}, {centre_lon:.5f}  spread {spread:.0f} m")
        print(f"  fetching streets within {radius:.0f} m...")
        data = fetch_streets(centre_lat, centre_lon, radius)
        roads = to_lines(data["roads"], lambda t: "road" if t.get("highway") else None)
        walks = to_lines(
            data["walks"],
            lambda t: "crossing" if t.get("footway") == "crossing"
            else ("sidewalk" if t.get("footway") == "sidewalk" or t.get("highway") == "footway" else None),
        )
        print(f"  {len(roads)} roads, {len(walks)} footways and crossings")

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
        snapped = 0
        for f in placed:
            if street.snap(f.lat, f.lon, max_distance_m=40.0):
                snapped += 1
        print(f"  snapped to a street: {snapped} of {len(placed)}")

        bbox = data["bbox"]
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps({
            "centre": {"lat": centre_lat, "lon": centre_lon},
            "bbox": [bbox.west, bbox.south, bbox.east, bbox.north],
            "roads": roads,
            "pedestrian": walks,
            "coverage": [],
            "session": {
                "frames": len(frames),
                "points": [{"lon": f.lon, "lat": f.lat} for f in placed],
                "photos": [],
            },
        }, separators=(",", ":")))
        print(f"  wrote {args.out}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
