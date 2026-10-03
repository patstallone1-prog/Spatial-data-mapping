#!/usr/bin/env python3
"""Place rights-reviewed real scans as explicitly labelled surrogate interiors.

Match footprint dimensions and dwelling/storey class, not guessed GPS. Every
display vertex must stay inside the canonical footprint. Uniform scale only,
within 10% of real scan scale. Reuse cap applies across the whole manifest.
Canonical geometry and factual exports are never modified.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]


def contains(points: np.ndarray, ring: np.ndarray) -> np.ndarray:
    inside = np.zeros(len(points), dtype=bool)
    x, y = points.T
    for a, b in zip(ring, np.roll(ring, -1, axis=0), strict=True):
        if abs(b[1] - a[1]) < 1e-12:
            continue
        hit = ((a[1] > y) != (b[1] > y)) & (x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0])
        inside ^= hit
    return inside


def terrain_sampler(directory=ROOT / "docs"):
    meta = json.loads((directory / "sf-corridor-terrain.json").read_text())["frame"]
    grid = np.fromfile(directory / "sf-corridor-terrain.bin", dtype="<i2").reshape(
        meta["rows"], meta["cols"]
    )

    def sample(points):
        x = (points[:, 0] - meta["mid_lon"]) * meta["metres_per_lon"]
        y = (points[:, 1] - meta["mid_lat"]) * meta["metres_per_lat"]
        u = np.clip((x - meta["x0"]) / meta["step_m"] - 0.5, 0, meta["cols"] - 1.001)
        v = np.clip((y - meta["y0"]) / meta["step_m"] - 0.5, 0, meta["rows"] - 1.001)
        ix, iy = u.astype(int), v.astype(int)
        tx, ty = u - ix, v - iy
        h = (
            grid[iy, ix] * (1 - tx) * (1 - ty)
            + grid[iy, ix + 1] * tx * (1 - ty)
            + grid[iy + 1, ix] * (1 - tx) * ty
            + grid[iy + 1, ix + 1] * tx * ty
        )
        return meta["base_m"] + h / 100

    return sample


def entrance_check(way, fit, sample):
    lon, lat = fit[4:6]
    px, py = 111320 * math.cos(math.radians(lat)), 111320
    absolute = np.asarray(way["points"])
    ring = (absolute - [lon, lat]) * [px, -py]
    low, high = ring.min(axis=0), ring.max(axis=0)
    xx, zz = np.meshgrid(np.arange(low[0], high[0] + 0.1, 2), np.arange(low[1], high[1] + 0.1, 2))
    points = np.column_stack([xx.ravel(), zz.ravel()])
    points = np.concatenate([ring, points[contains(points, ring)]])
    floor = float(sample(points / [px, -py] + [lon, lat]).max()) + 0.05
    for edge, t, width, source in fit[13]:
        a, b = ring[edge : edge + 2]
        delta = b - a
        length = np.linalg.norm(delta)
        if length < width + 0.2:
            continue
        centre = a + np.clip(t, width / (2 * length), 1 - width / (2 * length)) * delta
        normal = np.array([-delta[1], delta[0]]) / length
        if not contains(np.array([centre + normal * 0.5]), ring)[0]:
            normal *= -1
        street, uphill = sample(
            np.array([centre - normal * 0.6, centre + normal * 1.2]) / [px, -py] + [lon, lat]
        )
        rise = floor - street
        steps = math.ceil(rise / 0.18) if rise >= 0.08 else 0
        if rise >= 0.08 and (source == 2 and (steps > 3 or uphill - street < 0.15)):
            continue
        if rise >= 0.08:
            depth = steps * 0.3 + 1.2
            along, inward = np.meshgrid(
                np.arange(-(width + 0.4) / 2, (width + 0.4) / 2 + 0.01, 0.1),
                np.arange(0.03, depth + 0.01, 0.1),
            )
            samples = (
                centre + along.ravel()[:, None] * delta / length + inward.ravel()[:, None] * normal
            )
            if not contains(samples, ring).all():
                continue
        return {
            "edge": edge,
            "source": source,
            "rise_m": round(float(rise), 3),
            "steps": max(0, steps),
        }
    return None


def choose_scan_yaw(source, ring, fit, scale, rooms):
    """Two equally sized orientations; aim entry toward the largest observed room.

    This matches a borrowed layout to the entrance, never claims the actual
    address's room plan. Both orientations still require complete containment.
    """
    edge, t, _, _ = fit[13][0]
    a, b = ring[edge:edge + 2]
    direction = b - a
    normal = np.array([-direction[1], direction[0]]) / np.linalg.norm(direction)
    centre = a + t * direction
    if not contains(np.array([centre + normal * .5]), ring)[0]:
        normal *= -1
    access = centre + normal * 2.5
    open_room = max(rooms, key=lambda r: r.get("area_m2", 0))
    candidates = []
    for yaw in (math.radians(fit[6]), math.radians(fit[6]) + math.pi):
        c, s = math.cos(yaw), math.sin(yaw)
        rotation = np.array([[c, -s], [s, c]])
        if not contains(source * scale @ rotation, ring).all():
            continue
        local = access @ rotation.T / scale
        observed = any(contains(local[None, :], np.asarray(r["pts"]))[0] for r in rooms)
        distance = np.linalg.norm(local - np.asarray(open_room["pts"]).mean(axis=0))
        candidates.append((distance, not observed, yaw))
    return min(candidates)[2] if candidates else None


def validate_manifest(data: dict) -> None:
    uses = {}
    for placement in data["placements"]:
        scan = data["scans"][placement["scan"]]
        if scan["kind"] != "real_interior_scan" or not scan["sha256"]:
            raise ValueError("A catalogue or procedural plan is not a real scan")
        rights = scan.get("rights", {})
        if rights.get("status") != "approved" or not {
            "derived_mesh",
            "persistent_hosting",
            "redistribution",
        }.issubset(rights.get("allowed_uses", [])):
            raise ValueError("Scan redistribution rights are not approved")
        if not 0.9 <= placement["scale"] <= 1.1:
            raise ValueError("Unsafe scan stretch")
        if placement["grade"] != "matched_surrogate_not_address_truth":
            raise ValueError("A non-geolocated scan must not claim address truth")
        uses[placement["scan"]] = uses.get(placement["scan"], 0) + 1
        if uses[placement["scan"]] > min(8, scan["max_reuses"]):
            raise ValueError("Scan reuse limit exceeded")
        if not placement.get("address") or not placement.get("contained_vertices"):
            raise ValueError("Placement requires address and full-vertex containment proof")


def build(asset: Path, count: int = 3) -> dict:
    import trimesh
    from prepare_redwood_interior import scan_layout

    scan = json.loads(asset.with_suffix(".json").read_text())
    # This compiler is deliberately scoped to the independently reviewed
    # public-domain Redwood source, not a licence grant for arbitrary meshes.
    if (
        scan.get("id") != "redwood-apartment-2017"
        or scan.get("source_sha256")
        != "4a0b71672237e497d158441f6273d955c9015f8edb832fbcb44d05e3470de19d"
    ):
        raise ValueError("Unreviewed source: supply a separately reviewed scan adapter")
    scan["rights"] = {
        "status": "approved",
        "basis": "authors_public_domain_declaration",
        "allowed_uses": ["derived_mesh", "persistent_hosting", "redistribution", "commercial_use"],
        "reviewed_at": "2026-10-02",
    }
    if hashlib.sha256(asset.read_bytes()).hexdigest() != scan["sha256"]:
        raise ValueError("Scan checksum mismatch")
    mesh = trimesh.load(asset, force="mesh")
    scan["layout"] = scan_layout(mesh)
    source = mesh.vertices[:, [0, 2]]
    source_l, source_w = np.ptp(source, axis=0)
    candidates = []
    hashes = {}
    directories = {
        "sf-corridor": ROOT / "docs",
        "oakland-downtown": ROOT / "docs/app-regions/oakland-downtown",
    }
    directories.update(
        {
            p.name: p
            for p in (ROOT / "docs/regions").iterdir()
            if p.is_dir()
            and p.name not in directories
            and (p / "sf-corridor-interiors.json").exists()
        }
    )
    for region, directory in sorted(directories.items()):
        payload_path = directory / "sf-corridor-3d.json"
        if not (directory / "sf-corridor-terrain.bin").exists():
            continue
        sample = terrain_sampler(directory)
        payload = json.loads(payload_path.read_text())
        hashes[region] = {
            "path": str(payload_path.relative_to(ROOT / "docs")),
            "sha256": hashlib.sha256(payload_path.read_bytes()).hexdigest(),
        }
        interiors = json.loads((directory / "sf-corridor-interiors.json").read_text())
        for way in payload["ways"]:
            ident = str(way.get("osm_id"))
            fit = interiors["buildings"].get(ident)
            address = way.get("address", {}).get("formatted")
            if way.get("kind") != "building" or not fit or not address or not fit[13]:
                continue
            if way.get("archetype") != "residential" or fit[9] > 4:
                continue
            L, W = fit[7:9]
            scale = min(1.1, (L - 0.4) / source_l, (W - 0.4) / source_w)
            if scale < 0.9:
                continue
            occupied = source_l * source_w * scale**2 / (L * W)
            if occupied < 0.65:
                continue
            score = abs(math.log(L / source_l)) + abs(math.log(W / source_w)) + abs(math.log(scale))
            candidates.append((score, ident, way, fit, scale, region, sample))
    placements = []
    for score, ident, way, fit, scale, region, sample in sorted(
        candidates, key=lambda c: (c[0], c[1])
    ):
        if any(p["building"] == ident for p in placements):
            continue
        lon, lat = fit[4:6]
        px = 111412.84 * math.cos(math.radians(lat)) - 93.5 * math.cos(3 * math.radians(lat))
        py = (
            111132.92
            - 559.82 * math.cos(2 * math.radians(lat))
            + 1.175 * math.cos(4 * math.radians(lat))
        )
        ring = np.asarray(way["points"])
        ring = (ring - [lon, lat]) * [px, -py]
        angle = choose_scan_yaw(source, ring, fit, scale, scan["layout"]["rooms"])
        if angle is None:
            continue
        c, s = math.cos(angle), math.sin(angle)
        # glTF x/z -> page east/south, same axes as buildInterior/place().
        rotation = np.array([[c, -s], [s, c]])
        placed = source * scale @ rotation
        if not contains(placed, ring).all():
            continue
        entrance = entrance_check(way, fit, sample)
        if not entrance:
            continue
        placements.append(
            {
                "region": region,
                "building": ident,
                "address": way["address"]["formatted"],
                "scan": scan["id"],
                "lonlat": [lon, lat],
                "yaw": angle,
                "scale": round(scale, 8),
                "shape_match_score": round(score, 4),
                "contained_vertices": len(source),
                "grade": "matched_surrogate_not_address_truth",
                "entrance_preflight": entrance,
                "match_basis": "dwelling class, storeys, footprint dimensions and contained rigid orientation toward the largest observed open-floor region; actual house layout unknown",
            }
        )
        if len(placements) == count:
            break
    if len(placements) != count:
        raise ValueError(f"Only {len(placements)} contained placements, requested {count}")
    out = ROOT / "docs/interior-scans"
    out.mkdir(exist_ok=True)
    shutil.copyfile(asset, out / asset.name)
    scan["asset"] = "interior-scans/" + asset.name
    data = {
        "schema": 1,
        "note": "Real borrowed scans; none depicts the matched address's actual interior.",
        "canonical_payloads": hashes,
        "scans": {scan["id"]: scan},
        "placements": placements,
    }
    validate_manifest(data)
    (out / "manifest.json").write_text(json.dumps(data, indent=2) + "\n")
    return data


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("asset", type=Path)
    parser.add_argument("--count", type=int, default=3)
    args = parser.parse_args()
    result = build(args.asset, args.count)
    for record in result["placements"]:
        print(record["building"], record["address"], record["scale"])
