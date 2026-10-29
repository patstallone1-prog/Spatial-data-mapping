"""Multi-floor apartments on both sides of a shared hall, cut from each true outline."""

from __future__ import annotations

import math

from shapely import affinity, set_precision
from shapely.geometry import Point, box
from shapely.ops import unary_union

from smc.interiors.inference.partition import polygons, shared, width


def _connected(p):
    p = set_precision(p, 1e-7)
    if p.geom_type != "Polygon" or not p.is_valid or p.is_empty:
        raise ValueError("shared-hall program contains a disconnected/sliver region")
    return p


def _divide(wing, count, lobby):
    """Whole clipped components become homes; no rectangular outline substitution."""
    parts = sorted(polygons(wing), key=lambda p: p.bounds[0])
    if not parts or len(parts) > count:
        raise ValueError("shared hall leaves more disconnected wings than homes")
    allocations = [1] * len(parts)
    for _ in range(count - len(parts)):
        i = max(range(len(parts)), key=lambda i: parts[i].area / (allocations[i] + 1))
        allocations[i] += 1
    result = []
    for p, n in zip(parts, allocations, strict=True):
        x0, y0, x1, y1 = p.bounds
        last = x0 - 1
        for i in range(n):
            if i == n - 1:
                end = x1 + 1
            else:
                lo, hi = last, x1 + 1
                for _ in range(45):
                    mid = (lo + hi) / 2
                    if p.intersection(box(last, y0 - 1, mid, y1 + 1)).area < p.area / n:
                        lo = mid
                    else:
                        hi = mid
                end = (lo + hi) / 2
            q = _connected(p.intersection(box(last, y0 - 1, end, y1 + 1)))
            if q.area < 50 or width(q) < 2.9 or shared(q, lobby).length < 1.15:
                raise ValueError("shared-hall apartment lacks usable area or a private entry")
            result.append(q)
            last = end
    return result


def shared_hall_frames(spec, plans, angle, side, counts):
    origin = spec.footprint.centroid.coords[0]
    insides = [
        _connected((s.footprint or spec.footprint).buffer(-0.15, join_style=2))
        for s in spec.storeys
    ]
    locals = [affinity.rotate(p, -angle, origin=origin) for p in insides]
    common = locals[0]
    for p in locals[1:]:
        common = common.intersection(p)
    if common.is_empty:
        raise ValueError("floors have no shared stair alignment")
    x0, y0, x1, y1 = common.bounds
    hall_w = 2.24 if len(locals) > 1 else 1.65
    mid = (y0 + y1) / 2
    core = None
    cx = x0 if side == 0 else x1 - 2.24
    if len(locals) > 1:
        depth = max(4.2, math.ceil(max(s.height_m for s in spec.storeys) / 0.18 / 2) * 0.26 + 1.12)
        core = _connected(box(cx, mid + hall_w / 2, cx + 2.24, mid + hall_w / 2 + depth))
        if not common.buffer(0.001).covers(core):
            raise ValueError("shared-hall stair core does not fit every supplied floor")
    entry = affinity.rotate(Point(spec.entrance), -angle, origin=origin) if spec.entrance else None
    frames = []
    for level, (inside, p, count) in enumerate(zip(insides, locals, counts, strict=True)):
        px0, py0, px1, py1 = p.bounds
        if count >= 2:
            band = box(px0 - 1, mid - hall_w / 2, px1 + 1, mid + hall_w / 2)
        else:
            ax = cx if core is not None else px0 if side == 0 else px1 - hall_w
            band = box(ax, mid - hall_w / 2, ax + hall_w, mid + hall_w / 2)
        if level == spec.entrance_level:
            if entry is not None and abs(entry.y - py0) > 0.9:
                raise ValueError("entry is on another shared-hall frame face")
            ex = entry.x if entry else px0 + hall_w / 2 if side == 0 else px1 - hall_w / 2
            edge_x = px0 if side == 0 else px1 - hall_w
            direct = count >= 4
            if direct:
                connector = box(ex - hall_w / 2, py0 - 1, ex + hall_w / 2, mid + hall_w / 2)
            else:
                connector = unary_union(
                    [
                        box(edge_x, py0 - 1, edge_x + hall_w, mid + hall_w / 2),
                        box(
                            min(edge_x, ex - hall_w / 2),
                            py0 - 1,
                            max(edge_x + hall_w, ex + hall_w / 2),
                            py0 + hall_w,
                        ),
                        box(
                            min(edge_x, cx),
                            mid - hall_w / 2,
                            max(edge_x + hall_w, cx + hall_w),
                            mid + hall_w / 2,
                        ),
                    ]
                )
            band = unary_union([band, connector])
        lobby = _connected(p.intersection(band))
        if core is not None:
            lobby = _connected(lobby.difference(core))
        occupied = (
            [affinity.rotate(g["shape"], -angle, origin=origin) for g in plans]
            if level == 0
            else []
        )
        if any(
            lobby.intersection(g).area > 0.002
            or (core is not None and core.intersection(g).area > 0.002)
            for g in occupied
        ):
            raise ValueError("garage conflicts with the shared hall/stair core")
        remaining = p.difference(
            unary_union([lobby, *([core] if core is not None else []), *occupied])
        )
        regions = []
        if count == 1:
            regions = _divide(remaining, 1, lobby)
        elif count >= 2:
            for n, mask in [
                (count // 2, box(px0 - 1, py0 - 1, px1 + 1, mid - hall_w / 2)),
                (count - count // 2, box(px0 - 1, mid + hall_w / 2, px1 + 1, py1 + 1)),
            ]:
                regions += _divide(remaining.intersection(mask), n, lobby)

        def transform(p):
            return affinity.rotate(p, angle, origin=origin)

        frames.append(
            {
                "inside": inside,
                "core": transform(core) if core is not None else None,
                "lobby": transform(lobby),
                "regions": [transform(q) for q in regions],
                "remainder": transform(_connected(remaining)) if count == 0 else None,
            }
        )
    return frames
