"""Conservative, CPU pilot matching; production ALIKED/LightGlue remains in COLMAP.

Proximity proposes pairs, never proves overlap. Only mutual, epipolar-verified
matches joined into conflict-free three-view cycles become stationary tracks.
Masks must exclude temporary objects; optional surveyed/semantic landmark masks
prioritize corners, building edges and poles without declaring them ground truth.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from itertools import combinations

import cv2
import numpy as np

from smc.curbmeasure.geometry import Camera


@dataclass(frozen=True)
class Frame:
    camera: Camera
    sequence_id: str
    component_id: str
    pixel_sha256: str


@dataclass(frozen=True)
class Track:
    track_id: str
    pixels: dict[str, np.ndarray]


def candidate_pairs(frames: list[Frame], max_distance_m: float = 80.0) -> list[tuple[int, int]]:
    """Keep sequences intact; never triangulate unaligned provider components.

    Pixel-identical aliases are one view, not independent parallax. Connected
    verified pairs, rather than fixed spacing or sequence membership, define the
    actual overlap groups downstream.
    """
    if len({f.camera.image_id for f in frames}) != len(frames):
        raise ValueError("duplicate camera ID")
    unique, seen = [], set()
    for i, frame in enumerate(frames):
        if not frame.component_id or not frame.sequence_id or not frame.pixel_sha256:
            raise ValueError("sequence, aligned component and pixel hash required")
        if frame.pixel_sha256 not in seen:
            unique.append(i)
            seen.add(frame.pixel_sha256)
    pairs = []
    for a, b in combinations(unique, 2):
        ca, cb = frames[a].camera, frames[b].camera
        if frames[a].component_id != frames[b].component_id:
            continue
        baseline = np.linalg.norm(ca.centre - cb.centre)
        if 0.25 <= baseline <= max_distance_m and np.dot(ca.look(), cb.look()) > -0.25:
            pairs.append((a, b))
    return pairs


def mutual_matches(a: np.ndarray | None, b: np.ndarray | None) -> list[tuple[int, int]]:
    if a is None or b is None or min(len(a), len(b)) < 2:
        return []
    matcher = cv2.BFMatcher(cv2.NORM_L2)

    def good(x, y):
        return {
            (p[0].queryIdx, p[0].trainIdx)
            for p in matcher.knnMatch(x, y, k=2)
            if len(p) == 2 and p[0].distance < 0.75 * p[1].distance
        }

    forward, backward = good(a, b), good(b, a)
    return sorted((i, j) for i, j in forward if (j, i) in backward)


def overlap_groups(names: list[str], pairs: list[tuple[str, str]]) -> list[list[str]]:
    """Verified connected sequences, including unsupported singleton attempts."""
    adjacency = {name: set() for name in names}
    for a, b in pairs:
        adjacency[a].add(b)
        adjacency[b].add(a)
    seen, groups = set(), []
    for name in names:
        if name in seen:
            continue
        pending, group = [name], set()
        while pending:
            node = pending.pop()
            if node not in group:
                group.add(node)
                pending.extend(adjacency[node] - group)
        seen.update(group)
        groups.append(sorted(group))
    return groups


def cycle_tracks(keypoints: list[np.ndarray], edges: list[tuple], names: list[str]) -> list[Track]:
    """Discard ambiguous unions (two features in one camera), require a 3-cycle."""
    neighbours: dict[tuple[int, int], set] = {}
    for a, i, b, j in edges:
        neighbours.setdefault((a, i), set()).add((b, j))
        neighbours.setdefault((b, j), set()).add((a, i))
    seen, tracks = set(), []
    for seed in sorted(neighbours):
        if seed in seen:
            continue
        pending, group = [seed], set()
        while pending:
            node = pending.pop()
            if node not in group:
                group.add(node)
                pending.extend(neighbours[node] - group)
        seen.update(group)
        if len(group) < 3 or len({a for a, _ in group}) != len(group):
            continue
        triangle = any(
            z in neighbours[x] and z in neighbours[y]
            for x in group
            for y in neighbours[x]
            for z in group - {x, y}
        )
        if triangle:
            tracks.append(
                Track(
                    f"track-{len(tracks):06d}",
                    {names[a]: np.asarray(keypoints[a][i], float) for a, i in sorted(group)},
                )
            )
    return tracks


def match_frames(
    frames: list[Frame],
    images: list[np.ndarray],
    blocked: list[np.ndarray],
    landmarks: list[np.ndarray] | None = None,
    max_tracks: int = 192,
) -> tuple[list[Track], dict]:
    if not (len(frames) == len(images) == len(blocked)):
        raise ValueError("one image and exclusion mask per frame required")
    if landmarks is not None and len(landmarks) != len(frames):
        raise ValueError("one priority mask per frame required")
    detector = cv2.SIFT_create(nfeatures=6000)
    points, descriptors = [], []
    for i, (frame, image, mask) in enumerate(zip(frames, images, blocked, strict=True)):
        shape = (frame.camera.height, frame.camera.width)
        if image is None or image.shape[:2] != shape or mask.shape != shape:
            raise ValueError("calibration/image/mask dimensions disagree")
        if landmarks is not None and landmarks[i].shape != shape:
            raise ValueError("landmark mask dimensions disagree")
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
        # Keep SIFT's descriptor support away from redaction boundaries, not just its centre.
        excluded = cv2.dilate(mask.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
        excluded[:8] = excluded[-8:] = True
        excluded[:, :8] = excluded[:, -8:] = True
        kp, des = detector.detectAndCompute(gray, (~excluded).astype(np.uint8) * 255)
        # Large-scale descriptors must not reach across a temporary object either.
        distance = cv2.distanceTransform((~excluded).astype(np.uint8), cv2.DIST_L2, 3)
        order = [j for j, k in enumerate(kp) if distance[int(k.pt[1]), int(k.pt[0])] > k.size * 3]
        if landmarks is not None:
            order.sort(
                key=lambda j: (
                    bool(landmarks[i][int(kp[j].pt[1]), int(kp[j].pt[0])]),
                    kp[j].response,
                ),
                reverse=True,
            )
        order = order[:3000]
        points.append(np.array([kp[j].pt for j in order], dtype=float).reshape(-1, 2))
        descriptors.append(des[order] if len(order) else None)
    pairs, edges, verified = candidate_pairs(frames), [], []
    for a, b in pairs:
        matches = mutual_matches(descriptors[a], descriptors[b])
        if len(matches) < 12:
            continue

        def undistorted(index, indices):
            c = frames[index].camera
            rays = c.ray(points[index][indices]) @ c.rotation.T
            return rays[:, :2] / rays[:, 2:] * c.focal_px + c.principal

        pa = undistorted(a, [i for i, _ in matches])
        pb = undistorted(b, [j for _, j in matches])
        _, inliers = cv2.findFundamentalMat(pa, pb, cv2.FM_RANSAC, 1.5, 0.999)
        if inliers is None or int(inliers.sum()) < 12:
            continue
        verified.append((frames[a].camera.image_id, frames[b].camera.image_id))
        edges.extend(
            (a, i, b, j) for (i, j), keep in zip(matches, inliers.ravel(), strict=True) if keep
        )
    tracks = cycle_tracks(points, edges, [f.camera.image_id for f in frames])
    candidate_count = len(tracks)
    # A bounded pilot BA, spatially spread instead of taking the first texture patch.
    # Freeze this selection BEFORE reviewing any benchmark truth. No photo is thinned.
    if max_tracks < 8 or max_tracks > 256:
        raise ValueError("pilot track budget must be between 8 and 256")
    buckets = defaultdict(list)
    by_id = {f.camera.image_id: f.camera for f in frames}
    for track in sorted(tracks, key=lambda t: (-len(t.pixels), t.track_id)):
        name = min(track.pixels)
        x, y = track.pixels[name]
        c = by_id[name]
        buckets[(name, int(x * 8 / c.width), int(y * 6 / c.height))].append(track)
    selected = []
    while buckets and len(selected) < max_tracks:
        for key in list(buckets):
            selected.append(buckets[key].pop(0))
            if not buckets[key]:
                del buckets[key]
            if len(selected) == max_tracks:
                break
    tracks = selected
    return tracks, {
        "backend": "OpenCV SIFT CPU pilot; production uses ALIKED/LightGlue",
        "candidate_pairs": len(pairs),
        "verified_pairs": verified,
        "overlap_groups": overlap_groups([f.camera.image_id for f in frames], verified),
        "candidate_three_view_tracks": candidate_count,
        "three_view_tracks": len(tracks),
        "input_frames": len(frames),
    }
