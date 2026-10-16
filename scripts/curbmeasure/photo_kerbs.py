#!/usr/bin/env python3
"""Kerbs measured from photographs, scored against the lidar's kerbs.

For a sample of block faces the lidar has measured (``data/regions/<r>/lidar/kerb_stations.jsonl``),
the Mapillary photographs beside each face are read by :mod:`smc.curbmeasure.semantic`: the
kerb's foot placed on the road plane, its top giving the height. Each photographed kerb point
is compared with the lidar station nearest it -- how far off the kerb line it is, across the
street -- and each face's photographed height with the lidar's median for that face.

    set -a; source .env.local; set +a
    .venv/bin/python scripts/curbmeasure/photo_kerbs.py --region sf-mission --faces 40

``--faces 0 --box W,S,E,N`` measures every kerb photographed in a box instead, for streets the
lidar has not been asked about; the scoring is then whatever lidar stations happen to lie there.
"""

from __future__ import annotations

import argparse
import concurrent.futures as futures
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))

import numpy as np  # noqa: E402
import pyarrow.parquet as pq  # noqa: E402
from scipy.spatial import cKDTree  # noqa: E402

from smc.curbmeasure.semantic import (  # noqa: E402
    View,
    _get,
    fetch,
    fit_face,
    label_raster,
    measure,
    metres_per_degree,
)
from smc.net import use_certifi  # noqa: E402

use_certifi()

#: How near a photograph must stand to a face to be asked about it.
IMAGE_REACH_M = 12.0
#: A photographed kerb point further than this from every lidar station is not scored.
MATCH_M = 4.0


class Ground:
    """The lidar's ground elevation, from the region's stored point cells."""

    def __init__(self, region: str, data_root: Path = ROOT):
        pts, zs = [], []
        for path in (data_root / "data" / "regions" / region / "points").glob("*.npz"):
            with np.load(path) as d:
                ground = d["classification"] == 2
                if not ground.any():
                    continue
                meta = json.loads(bytes(d["meta"]).decode())
                xyz = d["xyz_cm"][ground].astype(float) / 100
                kx = 111_320 * math.cos(math.radians(meta["origin_lat"]))
                pts.append(
                    np.column_stack(
                        [
                            meta["origin_lon"] + xyz[:, 0] / kx,
                            meta["origin_lat"] + xyz[:, 1] / 111_320,
                        ]
                    )
                )
                zs.append(xyz[:, 2] + meta["base_z_m"])
        if not pts:
            raise SystemExit(f"{region}: no stored lidar cells (build_point_cells.py)")
        lonlat = np.vstack(pts)
        self.z = np.concatenate(zs)
        lat0 = float(np.median(lonlat[:, 1]))
        self.k = np.array(metres_per_degree(lat0))
        self.tree = cKDTree(lonlat * self.k)

    def at(self, lon: float, lat: float, radius_m: float = 1.5) -> float:
        idx = self.tree.query_ball_point(np.array([lon, lat]) * self.k, radius_m)
        return float(np.median(self.z[idx])) if len(idx) >= 3 else float("nan")


def load_faces(region: str, data_root: Path = ROOT) -> dict[tuple[str, str], list[dict]]:
    faces: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for line in (data_root / "data" / "regions" / region / "lidar" / "kerb_stations.jsonl").open():
        row = json.loads(line)
        faces[(row["way"], row["side"])].append(row)
    return faces


def sequence_heights(sequences: set[str], ground: Ground, cache: Path) -> dict[str, float]:
    """Each drive's camera height above the road: the median, over its frames, of the solved
    altitude less the lidar ground beneath."""
    out = {}
    cache.mkdir(parents=True, exist_ok=True)

    def one(seq: str) -> tuple[str, float]:
        path = cache / f"seq-{seq}.json"
        if path.exists():
            cached = json.loads(path.read_text())
            rows = cached.get("rows", []) if isinstance(cached, dict) else cached
        else:
            rows = []
        if not rows:
            try:
                rows = _get(
                    "images",
                    sequence_ids=seq,
                    limit=2000,
                    fields="id,computed_geometry,computed_altitude",
                ).get("data", [])
            except Exception:
                # A failed request is not a successfully observed empty sequence.
                # Leave it retryable rather than caching the failure indefinitely.
                return seq, float("nan")
            path.write_text(json.dumps({"status": "complete", "rows": rows}))
        diffs = []
        for row in rows[:: max(1, len(rows) // 150)]:
            if row.get("computed_altitude") is None or not row.get("computed_geometry"):
                continue
            lon, lat = row["computed_geometry"]["coordinates"][:2]
            g = ground.at(lon, lat)
            if np.isfinite(g):
                diffs.append(row["computed_altitude"] - g)
        return seq, float(np.median(diffs)) if len(diffs) >= 5 else float("nan")

    with futures.ThreadPoolExecutor(8) as pool:
        for seq, h in pool.map(one, sorted(sequences)):
            out[seq] = h
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--region", default="sf-mission")
    ap.add_argument("--faces", type=int, default=40)
    ap.add_argument("--images-per-face", type=int, default=24)
    ap.add_argument("--box", default="")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--out", type=Path, default=ROOT / "build" / "curbphoto")
    ap.add_argument(
        "--data-root",
        type=Path,
        default=ROOT,
        help="read-only evidence checkout; outputs stay under --out",
    )
    args = ap.parse_args()
    out = args.out / args.region
    cache = args.out / "cache"
    out.mkdir(parents=True, exist_ok=True)

    faces = load_faces(args.region, args.data_root)
    stations = [s for rows in faces.values() for s in rows]
    if not stations:
        ap.error("no lidar stations; cannot select or score a benchmark")
    lat0 = float(np.median([s["lat"] for s in stations]))
    k = np.array(metres_per_degree(lat0))
    station_xy = np.array([[s["lon"], s["lat"]] for s in stations]) * k
    station_tree = cKDTree(station_xy)

    catalog = pq.read_table(
        args.data_root
        / "data"
        / "regions"
        / args.region
        / "catalog"
        / "observations"
        / "external-000.parquet",
        columns=["provider", "provider_image_id", "latitude", "longitude", "provider_sequence_id"],
    ).to_pylist()
    photos = [r for r in catalog if r["provider"] == "mapillary"]
    if not photos:
        ap.error("no Mapillary photographs in the regional catalog")
    photo_xy = np.array([[r["longitude"], r["latitude"]] for r in photos]) * k
    photo_tree = cKDTree(photo_xy)

    rng = np.random.default_rng(args.seed)
    wanted: dict[str, dict] = {}
    if args.faces:
        good = [
            key
            for key, rows in faces.items()
            if len(rows) >= 8 and sum(r["height_m"] is not None for r in rows) >= 6
        ]
        if not good:
            ap.error("no sufficiently sampled lidar block faces")
        chosen = [good[i] for i in rng.choice(len(good), min(args.faces, len(good)), replace=False)]
        for key in chosen:
            kerb = np.array([[r["lon"], r["lat"]] for r in faces[key]]) * k
            near = set()
            for idx in photo_tree.query_ball_point(kerb, IMAGE_REACH_M):
                near.update(idx)
            near = sorted(near)
            by_seq: dict[str, list[int]] = defaultdict(list)
            for i in near:
                by_seq[photos[i]["provider_sequence_id"]].append(i)
            picked = []
            while len(picked) < args.images_per_face and any(by_seq.values()):
                for seq in list(by_seq):
                    if by_seq[seq]:
                        picked.append(by_seq[seq].pop(rng.integers(len(by_seq[seq]))))
            for i in picked[: args.images_per_face]:
                wanted[photos[i]["provider_image_id"]] = photos[i]
    else:
        w, s, e, n = map(float, args.box.split(","))
        for r in photos:
            if w <= r["longitude"] <= e and s <= r["latitude"] <= n:
                wanted[r["provider_image_id"]] = r
    print(f"{args.region}: {len(wanted)} photographs to read", flush=True)

    with futures.ThreadPoolExecutor(8) as pool:
        docs = [d for d in pool.map(lambda i: fetch(i, cache), sorted(wanted)) if d]
    views = [(View.from_doc(d), d) for d in docs]
    views = [(v, d) for v, d in views if v is not None]
    if not views:
        raise SystemExit(
            "no posed photographs fetched; check credentials/cache, not a measured-empty result"
        )
    ground = Ground(args.region, args.data_root)
    heights = sequence_heights({v.sequence for v, _ in views}, ground, cache)
    print(
        f"{len(views)} posed; camera heights for {sum(np.isfinite(h) for h in heights.values())}"
        f" of {len(heights)} drives",
        flush=True,
    )

    observations = []
    for view, doc in views:
        H = heights.get(view.sequence, float("nan"))
        if not np.isfinite(H) or not 0.8 <= H <= 4.5:
            continue
        for ob in measure(view, label_raster(doc, view.raster), H):
            row = ob.to_json()
            row["camera_type"] = view.camera_type
            observations.append(row)

    # Scored against the nearest lidar station: across the street, and in height.
    scored = []
    by_face: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for row in observations:
        p = np.array([row["lon"], row["lat"]]) * k
        dist, i = station_tree.query(p)
        if dist > MATCH_M:
            continue
        st = stations[i]
        centre = np.array(st["station"]) * k
        kerb = np.array([st["lon"], st["lat"]]) * k
        across = kerb - centre
        if np.linalg.norm(across) < 0.5:
            continue
        across /= np.linalg.norm(across)
        row["lateral_err"] = float((p - kerb) @ across)
        row["face"] = f"{st['way']}:{st['side']}"
        scored.append(row)
        by_face[(st["way"], st["side"])].append(row)

    face_rows = []
    for key, rows in by_face.items():
        lidar = [r["height_m"] for r in faces[key] if r["height_m"] is not None]
        if len(rows) < 6 or len(lidar) < 3:
            continue
        h = np.array([r["h"] for r in rows])
        t = np.array([r["tan_top"] for r in rows])
        fitted, slope = fit_face(h, t)
        face_rows.append(
            {
                "face": f"{key[0]}:{key[1]}",
                "observations": len(rows),
                "images": len({r["image"] for r in rows}),
                "photo_h_median": float(np.median(h)),
                "photo_h_fit": fitted,
                "stone_top_m": slope if np.isfinite(slope) else None,
                "lidar_h_median": float(np.median(lidar)),
                "lateral_median": float(np.median([r["lateral_err"] for r in rows])),
            }
        )

    (out / "observations.jsonl").write_text("".join(json.dumps(r) + "\n" for r in scored))
    (out / "raw_observations.jsonl").write_text("".join(json.dumps(r) + "\n" for r in observations))
    (out / "faces.json").write_text(json.dumps(face_rows, indent=1))
    lat = np.array([r["lateral_err"] for r in scored])
    report = {
        "photographs": len(views),
        "observations": len(observations),
        "scored": len(scored),
        "faces_scored": len(face_rows),
        "publishable": False,
        "matching_radius_m": MATCH_M,
        "unpaired": len(observations) - len(scored),
        "camera_height_basis": "sequence altitude minus lidar; datum compatibility unverified",
        "error_scope": "conditional on a nearest station within matching radius; not all points",
    }
    if len(lat):
        report["lateral_err_m"] = {
            "median": float(np.median(lat)),
            "mad": float(np.median(np.abs(lat - np.median(lat)))),
            "abs_p50": float(np.median(np.abs(lat))),
            "abs_p90": float(np.percentile(np.abs(lat), 90)),
        }
    if face_rows:
        for name in ("photo_h_median", "photo_h_fit"):
            err = np.array([f[name] - f["lidar_h_median"] for f in face_rows])
            report[f"face_{name}_err_m"] = {
                "median": float(np.median(err)),
                "abs_p50": float(np.median(np.abs(err))),
                "abs_p90": float(np.percentile(np.abs(err), 90)),
            }
        lf = np.array([f["lateral_median"] for f in face_rows])
        report["face_lateral_abs_p50"] = float(np.median(np.abs(lf)))
    (out / "report.json").write_text(json.dumps(report, indent=1))
    print(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
