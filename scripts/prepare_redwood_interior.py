#!/usr/bin/env python3
"""Compile the real Redwood apartment scan, without fetching its RGB-D sequence.

Input: Apartment/scene/integrated.ply from the authors' linked dataset, mirrored
by https://github.com/cvg/nice-slam/blob/master/scripts/download_apartment.sh.
Rights: http://redwood-data.org/indoor_lidar_rgbd/license.html (public domain).
Voxel averaging is a display LOD, not a new measurement. The source is retained
by checksum; this never modifies canonical building or collision geometry.

Requires numpy and trimesh (optional scan-build dependencies).
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np


def scan_layout(mesh) -> dict:
    """Display navigation derived from the surrogate mesh, not address truth."""
    import cv2
    import trimesh

    step = 0.08
    low, high = mesh.bounds[:, [0, 2]]
    shape = tuple((np.ceil((high - low) / step).astype(int) + 5)[::-1])

    def pixels(points):
        return np.round((np.asarray(points) - low) / step).astype("i4") + 2

    ground = np.zeros(shape, "u1")
    triangles = mesh.triangles
    floor = (np.max(np.abs(triangles[:, :, 1]), axis=1) < 0.12) & (
        np.abs(mesh.face_normals[:, 1]) > 0.65
    )
    for tri in triangles[floor]:
        cv2.fillPoly(ground, [pixels(tri[:, [0, 2]])], 255)
    ground = cv2.morphologyEx(ground, cv2.MORPH_CLOSE, np.ones((5, 5), "u1"))
    ground = cv2.dilate(ground, np.ones((3, 3), "u1"))
    contours, _ = cv2.findContours(ground, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    floor_mask = np.zeros_like(ground)
    contours = [c for c in contours if cv2.contourArea(c) * step**2 > 3]
    cv2.fillPoly(floor_mask, contours, 255)
    wall_mask = np.zeros_like(ground)
    section = trimesh.intersections.mesh_plane(mesh, [0, 1, 0], [0, 1.25, 0])
    if not len(section):
        raise ValueError("Scan has no standing-height wall section")
    segments = []
    for line in section:
        pts = pixels(line[:, [0, 2]])
        cv2.polylines(wall_mask, [pts], False, 255, 2)
    walls, _ = cv2.findContours(wall_mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    for line in walls:
        simple = cv2.approxPolyDP(line, 1.25, True).reshape(-1, 2)
        local = (simple - 2) * step + low
        for a, b in zip(local, np.roll(local, -1, axis=0), strict=True):
            if np.linalg.norm(b - a) > 0.15:
                segments.append([*a, *b])
    # Close only doorway-width gaps to identify rooms for camera placement;
    # these closed gaps are NOT added to the walker's collision walls.
    closed = cv2.morphologyEx(wall_mask, cv2.MORPH_CLOSE, np.ones((13, 13), "u1"))
    free = cv2.bitwise_and(floor_mask, cv2.bitwise_not(closed))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(free)
    rooms = []
    for label in range(1, count):
        area = stats[label, cv2.CC_STAT_AREA] * step**2
        if area < 3:
            continue
        cs, _ = cv2.findContours(
            (labels == label).astype("u1"), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )
        contour = max(cs, key=cv2.contourArea)
        pts = (cv2.approxPolyDP(contour, 2, True).reshape(-1, 2) - 2) * step + low
        rooms.append(
            {"kind": "scanned_room", "area_m2": round(area, 2), "pts": pts.round(4).tolist()}
        )
    if not rooms:
        raise ValueError("No room-sized connected floor in real scan")
    return {
        "grade": "surrogate_scan_not_geolocated_collision",
        "grid_m": step,
        "rooms": rooms,
        "segments": np.round(segments, 4).tolist(),
    }


def compile_scan(path: Path, output: Path, voxel: float = 0.06) -> dict:
    import trimesh

    with path.open("rb") as stream:
        header = []
        while True:
            line = stream.readline().decode("ascii").strip()
            header.append(line)
            if line == "end_header":
                break
        offset = stream.tell()
    expected = [
        "property double x",
        "property double y",
        "property double z",
        "property double nx",
        "property double ny",
        "property double nz",
        "property uchar red",
        "property uchar green",
        "property uchar blue",
    ]
    if "format binary_little_endian 1.0" not in header or header[4:13] != expected:
        raise ValueError("Unexpected Redwood PLY schema; refuse to guess its layout")
    nv = int(next(s for s in header if s.startswith("element vertex ")).split()[-1])
    nf = int(next(s for s in header if s.startswith("element face ")).split()[-1])
    dtype = np.dtype(
        [(name, "<f8") for name in ("x", "y", "z", "nx", "ny", "nz")]
        + [(name, "u1") for name in ("red", "green", "blue")]
    )
    vertices = np.memmap(path, dtype=dtype, offset=offset, shape=(nv,), mode="r")
    positions = np.column_stack([vertices[n] for n in ("x", "y", "z")]).astype("f4")
    # Azure/Open3D camera coordinates: y increases downwards. A 180-degree
    # rotation about x makes the exported scan y-up without reflecting it.
    positions[:, 1:] *= -1
    q = np.floor(positions / voxel).astype("i4")
    q -= q.min(axis=0)
    span = q.max(axis=0).astype("i8") + 1
    keys = (q[:, 0].astype("i8") * span[1] + q[:, 1]) * span[2] + q[:, 2]
    del q
    _, inverse, counts = np.unique(keys, return_inverse=True, return_counts=True)
    del keys
    inverse = inverse.astype("u4")
    n = len(counts)
    reduced = np.column_stack(
        [np.bincount(inverse, weights=positions[:, k], minlength=n) / counts for k in range(3)]
    ).astype("f4")
    del positions
    colours = np.column_stack(
        [
            np.bincount(inverse, weights=vertices[k], minlength=n) / counts
            for k in ("red", "green", "blue")
        ]
    ).astype("u1")
    faces = np.memmap(
        path,
        dtype=[("count", "u1"), ("indices", "<u4", (3,))],
        offset=offset + nv * dtype.itemsize,
        shape=(nf,),
        mode="r",
    )
    kept = []
    for start in range(0, nf, 500_000):
        chunk = faces[start : start + 500_000]
        if np.any(chunk["count"] != 3):
            raise ValueError("Non-triangular source face")
        f = inverse[chunk["indices"]]
        valid = (f[:, 0] != f[:, 1]) & (f[:, 0] != f[:, 2]) & (f[:, 1] != f[:, 2])
        kept.append(f[valid])
    del inverse
    triangles = np.concatenate(kept)
    _, indices = np.unique(np.sort(triangles, axis=1), axis=0, return_index=True)
    triangles = triangles[np.sort(indices)]
    mesh = trimesh.Trimesh(reduced, triangles, vertex_colors=colours, process=False)
    mesh.remove_unreferenced_vertices()
    # The capture's camera frame is tilted, not gravity-aligned. Fit its large
    # low horizontal surface, and apply ONE rigid rotation/translation to the
    # complete scan. Never flatten individual vertices or stretch rooms.
    normals = mesh.face_normals.copy()
    normals[normals[:, 1] < 0] *= -1
    centres, weights = mesh.triangles_center, mesh.area_faces
    horizontal = normals[:, 1] > 0.85
    normal = np.average(normals[horizontal], axis=0, weights=weights[horizontal])
    normal /= np.linalg.norm(normal)
    d = centres @ normal
    bins = np.round(d / 0.05).astype("i4")
    values, inv = np.unique(bins[horizontal], return_inverse=True)
    mass = np.bincount(inv, weights=weights[horizontal])
    mode = values[np.argmax(mass)] * 0.05
    floor = horizontal & (np.abs(d - mode) < 0.3)
    design = np.column_stack([centres[:, 0], centres[:, 2], np.ones(len(centres))])
    for _ in range(3):
        w = np.sqrt(weights[floor])
        coeff = np.linalg.lstsq(design[floor] * w[:, None], centres[floor, 1] * w, rcond=None)[0]
        residual = np.abs(centres[:, 1] - design @ coeff)
        floor &= residual < 0.08
    normal = np.array([-coeff[0], 1, -coeff[1]])
    normal /= np.linalg.norm(normal)
    rotation = trimesh.geometry.align_vectors(normal, [0, 1, 0])
    rotation[1, 3] = -coeff[2] * normal[1]
    mesh.apply_transform(rotation)
    floor_error = np.abs(mesh.triangles_center[floor, 1])
    best = None
    # A rigid yaw for the tightest bounding rectangle; no nonuniform scaling.
    for angle in np.linspace(0, np.pi / 2, 181):
        c, s = np.cos(angle), np.sin(angle)
        points = mesh.vertices[:, [0, 2]] @ np.array([[c, -s], [s, c]])
        size = np.ptp(points, axis=0)
        if best is None or np.prod(size) < best[0]:
            best = (np.prod(size), angle)
    yaw = trimesh.transformations.rotation_matrix(best[1], [0, 1, 0])
    mesh.apply_transform(yaw)
    centre = mesh.bounds.mean(axis=0)
    yaw[:3, 3] = [-centre[0], 0, -centre[2]]
    mesh.apply_translation(yaw[:3, 3])
    rotation = yaw @ rotation
    print("bounds", mesh.bounds.tolist(), "faces", len(mesh.faces), flush=True)
    # Summarize real horizontal surface samples for floor/ceiling review.
    flat = np.abs(mesh.vertex_normals[:, 1]) > 0.9
    bins, counts = np.unique(np.round(mesh.vertices[flat, 1] / 0.1), return_counts=True)
    print(
        "horizontal y modes",
        sorted(zip(bins * 0.1, counts, strict=True), key=lambda p: -p[1])[:15],
        flush=True,
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(mesh.export(file_type="glb"))
    with path.open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    manifest = {
        "schema": 1,
        "id": "redwood-apartment-2017",
        "kind": "real_interior_scan",
        "source": "Redwood Indoor Lidar-RGBD Scan Dataset, Apartment",
        "source_url": "http://redwood-data.org/indoor_lidar_rgbd/download.html",
        "license_url": "http://redwood-data.org/indoor_lidar_rgbd/license.html",
        "license": "Public domain; attribution requested",
        "attribution": "Jaesik Park, Qian-Yi Zhou and Vladlen Koltun, Colored Point Cloud Registration Revisited, ICCV 2017",
        "source_sha256": digest,
        "source_vertices": nv,
        "source_triangles": nf,
        "display_voxel_m": voxel,
        "display_vertices": len(mesh.vertices),
        "display_triangles": len(mesh.faces),
        "bounds": mesh.bounds.tolist(),
        "gravity_alignment": rotation.tolist(),
        "floor_fit_area_m2": float(weights[floor].sum()),
        "floor_fit_p95_m": float(np.quantile(floor_error, 0.95)),
        "asset": output.name,
        "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "bytes": output.stat().st_size,
        "gps_known": False,
        "placement_grade": "matched_surrogate_not_address_truth",
        "max_reuses": 8,
    }
    manifest["layout"] = scan_layout(mesh)
    output.with_suffix(".json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--voxel", type=float, default=0.06)
    args = parser.parse_args()
    print(json.dumps(compile_scan(args.input, args.output, args.voxel), indent=2))
