"""Small-window, fixed-calibration translation/landmark bundle adjustment.

This is a diagnostic companion to full COLMAP BA, not a replacement. Sensor/SfM
rotations are held fixed by default; bounded rotation refinement is experimental
and opt-in. Intrinsics always remain fixed. Data rank is
checked before optimization, without damping/GNSS priors manufacturing certainty.
Metric controls are independent, named fitting evidence, never test checkpoints.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

import numpy as np
from scipy.optimize import least_squares
from scipy.spatial.transform import Rotation

from smc.curbmeasure.geometry import Camera, triangulate
from smc.reconstruction.matching import Track


@dataclass(frozen=True)
class Control:
    track_id: str
    xyz: np.ndarray
    sigma_m: float
    source_id: str


@dataclass(frozen=True)
class Relation:
    """A measured local distance, or an explicitly uncertain transferred relation.

    Street-width changes/intersections must use a different scope. A neighbouring
    block's width is only an assumption, with transfer uncertainty, not a fact.
    """

    a: str
    b: str
    distance_m: float
    sigma_m: float
    source_id: str
    kind: str
    scope_id: str
    transfer_sigma_m: float = 0.0
    source_scope_id: str = ""


def rank_report(jacobian: np.ndarray) -> dict:
    # Dimensionless column scaling prevents metres/texels from deciding rank.
    norm = np.linalg.norm(jacobian, axis=0)
    scaled = jacobian / np.maximum(norm, 1e-12)
    singular = np.linalg.svd(scaled, compute_uv=False)
    rank = int(np.sum(singular > max(1e-8, singular[0] * 1e-6))) if len(singular) else 0
    return {
        "rank": rank,
        "unknowns": jacobian.shape[1],
        "nullity": jacobian.shape[1] - rank,
        "smallest_singular_value": float(singular[-1]) if len(singular) else 0.0,
    }


def refine(
    cameras: list[Camera],
    tracks: list[Track],
    controls: list[Control],
    relations: list[Relation] | None = None,
    *,
    optimize_rotations: bool = False,
) -> dict:
    base = {
        "publishable": False,
        "fixed_intrinsics_and_rotations": not optimize_rotations,
        "fixed_intrinsics": True,
        "attempted_tracks": len(tracks),
        "optimization_attempted": False,
    }
    if len(cameras) < 3 or len(cameras) > 12 or len(tracks) > 256:
        raise ValueError("pilot window requires 3-12 cameras and at most 256 tracks")
    by_id = {c.image_id: c for c in cameras}
    if len(by_id) != len(cameras) or len({t.track_id for t in tracks}) != len(tracks):
        raise ValueError("duplicate camera/track ID")
    for camera in cameras:
        if (
            not np.isfinite(camera.centre).all()
            or camera.centre.shape != (3,)
            or camera.rotation.shape != (3, 3)
            or not np.isfinite(camera.rotation).all()
            or camera.focal_px <= 0
            or camera.focal_y_px <= 0
            or not np.isfinite(
                [camera.focal_px, camera.focal_y_px, *camera.principal, camera.k1, camera.k2]
            ).all()
            or not np.allclose(camera.rotation @ camera.rotation.T, np.eye(3), atol=1e-5)
            or not np.isclose(np.linalg.det(camera.rotation), 1)
        ):
            raise ValueError("finite metric cameras with calibrated rotations required")
    usable, initial, rejected = [], [], {}
    for track in tracks:
        if not set(track.pixels) <= by_id.keys():
            raise ValueError("track references unknown camera")
        if any(np.shape(px) != (2,) or not np.isfinite(px).all() for px in track.pixels.values()):
            raise ValueError("track pixels must be finite pairs")
        if len(track.pixels) < 3:
            rejected[track.track_id] = "fewer_than_three_views"
            continue
        cams = [by_id[k] for k in track.pixels]
        point = triangulate(cams, list(track.pixels.values()))
        if not np.isfinite(point).all():
            rejected[track.track_id] = "unobservable_or_behind_camera"
            continue
        error = [np.linalg.norm(c.project(point)[0] - track.pixels[c.image_id]) for c in cams]
        if max(error) > 40:
            rejected[track.track_id] = "inconsistent_track"
            continue
        usable.append(track)
        initial.append(point)
    base.update({"rejected_tracks": rejected, "triangulated_tracks": len(usable)})
    if len(usable) < 8 or any(sum(c.image_id in t.pixels for t in usable) < 6 for c in cameras):
        return {**base, "status": "insufficient_observable_tracks"}
    ids = {t.track_id: i for i, t in enumerate(usable)}
    if len({c.track_id for c in controls}) != len(controls):
        raise ValueError("duplicate control would overcount independent evidence")
    for c in controls:
        if (
            c.track_id not in ids
            or not c.source_id
            or not np.isfinite(c.sigma_m)
            or c.sigma_m <= 0
            or np.shape(c.xyz) != (3,)
            or not np.isfinite(c.xyz).all()
        ):
            raise ValueError("finite, identified fitting controls with source and sigma required")
    relations = relations or []
    if len({tuple(sorted((r.a, r.b))) for r in relations}) != len(relations):
        raise ValueError("duplicate spatial relation would overcount evidence")
    for r in relations:
        if (
            r.a not in ids
            or r.b not in ids
            or r.a == r.b
            or not r.source_id
            or not r.scope_id
            or r.kind not in {"street_width", "curb_building_setback"}
            or not np.isfinite([r.distance_m, r.sigma_m, r.transfer_sigma_m]).all()
            or r.distance_m <= 0
            or r.sigma_m <= 0
            or r.transfer_sigma_m < 0
        ):
            raise ValueError("spatial relation needs identified endpoints, provenance and sigma")
        if r.source_scope_id and r.source_scope_id != r.scope_id and r.transfer_sigma_m <= 0:
            raise ValueError("transferred spatial relation requires nonzero transfer uncertainty")
    # Relations outside the initial geometry's uncertainty are held for review,
    # rather than forcing a street to a standard/nearby width.
    kept, conflicts = [], []
    for r in relations:
        sigma = float(np.hypot(r.sigma_m, r.transfer_sigma_m))
        if (
            abs(np.linalg.norm((initial[ids[r.a]] - initial[ids[r.b]])[:2]) - r.distance_m)
            > 4 * sigma
        ):
            conflicts.append(
                {
                    "source_id": r.source_id,
                    "scope_id": r.scope_id,
                    "reason": "spatial_relation_conflict",
                }
            )
        else:
            kept.append(r)
    base["spatial_relation_conflicts"] = conflicts
    base["spatial_relations_used"] = len(kept)
    ncam = len(cameras)
    point_offset = ncam * (6 if optimize_rotations else 3)
    camera_index = {c.image_id: i for i, c in enumerate(cameras)}
    observations = [
        (camera_index[k], i, np.asarray(px, float))
        for i, t in enumerate(usable)
        for k, px in t.pixels.items()
    ]
    start = np.concatenate(
        [
            np.array([c.centre for c in cameras]).ravel(),
            np.zeros(3 * ncam) if optimize_rotations else np.array([]),
            np.array(initial).ravel(),
        ]
    )

    def evaluate(x, with_metric=True):
        centres, points = x[: ncam * 3].reshape(-1, 3), x[point_offset:].reshape(-1, 3)
        rotations = (
            [
                Rotation.from_rotvec(v).as_matrix() @ c.rotation
                for c, v in zip(cameras, x[ncam * 3 : point_offset].reshape(-1, 3), strict=True)
            ]
            if optimize_rotations
            else [c.rotation for c in cameras]
        )
        residual, jacobian = [], []
        for ci, pi, px in observations:
            camera = replace(cameras[ci], centre=centres[ci], rotation=rotations[ci])
            projected = camera.project(points[pi])[0]
            residual.extend(np.nan_to_num(projected - px, nan=1e6))
            derivative = np.column_stack(
                [
                    (
                        camera.project(points[pi] + np.eye(3)[d] * 1e-5)[0]
                        - camera.project(points[pi] - np.eye(3)[d] * 1e-5)[0]
                    )
                    / 2e-5
                    for d in range(3)
                ]
            )
            row = np.zeros((2, len(x)))
            row[:, ci * 3 : ci * 3 + 3] = -np.nan_to_num(derivative)
            row[:, point_offset + pi * 3 : point_offset + (pi + 1) * 3] = np.nan_to_num(derivative)
            if optimize_rotations:
                angles = x[ncam * 3 + ci * 3 : ncam * 3 + (ci + 1) * 3]
                for d in range(3):
                    plus = Rotation.from_rotvec(angles + np.eye(3)[d] * 1e-6).as_matrix()
                    minus = Rotation.from_rotvec(angles - np.eye(3)[d] * 1e-6).as_matrix()
                    derivative_angle = (
                        replace(camera, rotation=plus @ cameras[ci].rotation).project(points[pi])[0]
                        - replace(camera, rotation=minus @ cameras[ci].rotation).project(
                            points[pi]
                        )[0]
                    ) / 2e-6
                    row[:, ncam * 3 + ci * 3 + d] = np.nan_to_num(derivative_angle)
            jacobian.extend(row)
        if with_metric:
            for control in controls:
                pi = ids[control.track_id]
                residual.extend((points[pi] - control.xyz) / control.sigma_m)
                row = np.zeros((3, len(x)))
                row[:, point_offset + pi * 3 : point_offset + (pi + 1) * 3] = (
                    np.eye(3) / control.sigma_m
                )
                jacobian.extend(row)
            for r in kept:
                a, b = ids[r.a], ids[r.b]
                # Width/setback are horizontal plan distances, not hillside slant lengths.
                delta = (points[a] - points[b]).copy()
                delta[2] = 0
                distance = max(float(np.linalg.norm(delta)), 1e-9)
                sigma = np.hypot(r.sigma_m, r.transfer_sigma_m)
                residual.append((distance - r.distance_m) / sigma)
                row = np.zeros(len(x))
                row[point_offset + a * 3 : point_offset + (a + 1) * 3] = delta / distance / sigma
                row[point_offset + b * 3 : point_offset + (b + 1) * 3] = -delta / distance / sigma
                jacobian.append(row)
        return np.array(residual), np.array(jacobian)

    visual_rank = rank_report(evaluate(start, False)[1])
    anchored_rank = rank_report(evaluate(start)[1])
    base.update({"visual_observability": visual_rank, "metric_observability": anchored_rank})
    # Known rotations leave a four-dimensional translation/scale gauge. Extra
    # null directions are visual degeneracy; priors must not silently repair it.
    if visual_rank["nullity"] > (7 if optimize_rotations else 4) or anchored_rank["nullity"]:
        return {**base, "status": "unobservable"}
    lower, upper = np.full(len(start), -np.inf), np.full(len(start), np.inf)
    if optimize_rotations:
        # Hard physical limits are not residual priors and do not add data rank.
        lower[ncam * 3 : point_offset] = -np.deg2rad(2)
        upper[ncam * 3 : point_offset] = np.deg2rad(2)
    fit = least_squares(
        lambda x: evaluate(x)[0],
        start,
        jac=lambda x: evaluate(x)[1],
        loss="soft_l1",
        f_scale=1.5,
        max_nfev=100,
        x_scale="jac",
        bounds=(lower, upper),
    )
    base["optimization_attempted"] = True
    centres = fit.x[: ncam * 3].reshape(-1, 3)
    points = fit.x[point_offset:].reshape(-1, 3)
    rotations = (
        [
            Rotation.from_rotvec(v).as_matrix() @ c.rotation
            for c, v in zip(cameras, fit.x[ncam * 3 : point_offset].reshape(-1, 3), strict=True)
        ]
        if optimize_rotations
        else [c.rotation for c in cameras]
    )
    residual, jac = evaluate(fit.x)
    pixel_errors = np.linalg.norm(residual[: 2 * len(observations)].reshape(-1, 2), axis=1)
    after = rank_report(jac)
    front = all((rotations[ci] @ (points[pi] - centres[ci]))[2] > 0 for ci, pi, _ in observations)
    # Every observation must agree. A low median cannot conceal a bad track/view.
    accepted = bool(
        fit.success
        and front
        and after["nullity"] == 0
        and np.max(pixel_errors) <= 5
        and np.max(np.abs(residual[2 * len(observations) :]), initial=0) <= 4
        and not np.any(fit.active_mask)
    )
    return {
        **base,
        "status": "reconstructed" if accepted else "failed_quality_gate",
        "final_observability": after,
        "reprojection_median_px": float(np.median(pixel_errors)),
        "reprojection_p90_px": float(np.percentile(pixel_errors, 90)),
        "fitting_control_sources": sorted({c.source_id for c in controls}),
        "relation_sources": sorted({r.source_id for r in kept}),
        "spatial_relations": [
            {
                "source_id": r.source_id,
                "kind": r.kind,
                "scope_id": r.scope_id,
                "source_scope_id": r.source_scope_id,
                "sigma_m": float(np.hypot(r.sigma_m, r.transfer_sigma_m)),
                "inferred_transfer": bool(r.source_scope_id and r.source_scope_id != r.scope_id),
            }
            for r in kept
        ],
        # Do not return rejected candidate geometry for accidental downstream use.
        **(
            {
                "cameras": {c.image_id: centres[i].tolist() for i, c in enumerate(cameras)},
                "points": {t.track_id: points[i].tolist() for i, t in enumerate(usable)},
                "rotations": {c.image_id: rotations[i].tolist() for i, c in enumerate(cameras)},
            }
            if accepted
            else {}
        ),
    }
