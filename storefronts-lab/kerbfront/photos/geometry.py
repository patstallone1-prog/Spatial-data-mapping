"""Stage 1 photo filter: does this frame see this face, and how well? (no pixels needed)

Every frame within range of a street face is assessed against it. Hard gates reject frames
that cannot show the face; the rest get component scores and two combined scores:

* ``architecture`` -- shell, materials, openings, cornice. Any era since the building's last
  exterior alteration is usable; an oblique view is welcome (it shows depth: awnings,
  projecting signs, bays).
* ``signage`` -- the *current* business: sign text, awning lettering, door vinyl. A frame
  captured before the tenant moved in shows the previous occupant and scores zero; resolution
  matters more and recency decays faster.

Thresholds are engineering priors chosen for 0.3 m sign letters and storefront-band detail,
not fitted statistics; ``tests/test_photo_geometry.py`` pins their behaviour.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timezone

from shapely.geometry import LineString, Polygon
from shapely.strtree import STRtree

from .. import sun
from ..faces import Face
from ..geo import ang_diff, bearing

MAX_RANGE_M = 40.0
MIN_RANGE_M = 2.0
MAX_INCIDENCE_DEG = 72.0
MIN_IN_VIEW = 0.6               # a span half out of frame sits in the distorted edge
MIN_VISIBLE = 0.4
STOREFRONT_BAND = (0.0, 4.5)     # ground storey, where signs, awnings and doors live
CAMERA_HEIGHT_M = 2.0            # car roof ~2.2, handheld ~1.6
PPM_FLOOR, PPM_GOOD = 8.0, 80.0  # pixels per facade metre: shapes vs legible 0.3 m letters
SIGN_PPM_MIN = 25.0
MIN_SPAN_PX = 100.0              # the tenant span's projected width (~33 px/m on a 3 m shop)


@dataclass
class Assessment:
    frame_id: str
    face_id: str
    rejects: list[str] = field(default_factory=list)
    flags: list[str] = field(default_factory=list)
    metrics: dict = field(default_factory=dict)
    scores: dict = field(default_factory=dict)
    view: str | None = None
    aim: dict | None = None

    @property
    def ok(self) -> bool:
        return not self.rejects

    def to_json(self) -> dict:
        return {"frame_id": self.frame_id, "face_id": self.face_id, "ok": self.ok,
                "rejects": self.rejects, "flags": self.flags, "view": self.view,
                "aim": self.aim, "metrics": {k: (round(v, 3) if isinstance(v, float) else v)
                                             for k, v in self.metrics.items()},
                "scores": {k: round(v, 4) for k, v in self.scores.items()}}


def _parse_time(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        t = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def px_per_radian(frame: dict, width: int | None = None) -> float:
    w = width or frame.get("width") or 2048
    hfov = frame.get("hfov") or 70.0
    if frame.get("camera_type") in ("spherical", "equirectangular") or hfov >= 359:
        return w / (2 * math.pi)
    return (w / 2) / math.tan(math.radians(hfov) / 2)


def _overlap(a: tuple[float, float], b: tuple[float, float]) -> float:
    return max(0.0, min(a[1], b[1]) - max(a[0], b[0]))


def occlusion_free(cam: tuple[float, float], face: Face, own: Polygon | None,
                   tree: STRtree | None, polys: list[Polygon], samples: int = 9) -> float:
    """Share of face sample points whose sight line from the camera crosses no building."""
    free = 0
    shrunk = own.buffer(-0.3) if own is not None else None
    for k in range(samples):
        f = 0.1 + 0.8 * k / (samples - 1)
        px = face.p0[0] + (face.p1[0] - face.p0[0]) * f
        py = face.p0[1] + (face.p1[1] - face.p0[1]) * f
        dx, dy = px - cam[0], py - cam[1]
        L = math.hypot(dx, dy)
        if L < 0.5:
            free += 1
            continue
        end = (cam[0] + dx * (L - 0.4) / L, cam[1] + dy * (L - 0.4) / L)
        ray = LineString([cam, end])
        blocked = False
        if shrunk is not None and not shrunk.is_empty and ray.intersects(shrunk):
            blocked = True
        if not blocked and tree is not None:
            for j in tree.query(ray):
                p = polys[j]
                if p is own:
                    continue
                if ray.intersection(p).length > 0.25:
                    blocked = True
                    break
        free += not blocked
    return free / samples


def assess(face: Face, frame: dict, cam: tuple[float, float], *, building_h: float | None,
           own: Polygon | None = None, tree: STRtree | None = None,
           polys: list[Polygon] | None = None, tenant_since: str | None = None,
           altered_on: str | None = None, now: datetime | None = None,
           lat: float = 37.80, lon: float = -122.44) -> Assessment:
    a = Assessment(frame["id"], face.id)
    nx, ny = face.normal
    tx, ty = -ny, nx  # edge direction (p0 -> p1)
    mx, my = face.mid
    dx, dy = cam[0] - mx, cam[1] - my
    r = math.hypot(dx, dy)
    perp = dx * nx + dy * ny
    along = dx * tx + dy * ty
    m = a.metrics
    m.update(range_m=r, perp_m=perp, along_m=along)
    if perp <= 0.5:
        a.rejects.append("behind_face")
    if r > MAX_RANGE_M:
        a.rejects.append("too_far")
    if r < MIN_RANGE_M:
        a.rejects.append("too_close")
    inc = math.degrees(math.acos(max(-1.0, min(1.0, perp / r)))) if r > 0 else 90.0
    m["incidence_deg"] = inc
    if inc > MAX_INCIDENCE_DEG:
        a.rejects.append("grazing")

    if frame.get("camera_type") == "fisheye":
        a.rejects.append("fisheye_unsupported")  # needs the solved lens model to aim crops
    spherical = frame.get("camera_type") in ("spherical", "equirectangular") or frame.get("hfov", 0) >= 359
    hfov = 360.0 if spherical else float(frame.get("hfov") or 70.0)
    heading = float(frame["heading"])
    bearings = []
    for k in range(11):
        f = k / 10
        px = face.p0[0] + (face.p1[0] - face.p0[0]) * f
        py = face.p0[1] + (face.p1[1] - face.p0[1]) * f
        bearings.append(bearing(px - cam[0], py - cam[1]))
    if spherical:
        in_view = 1.0
    else:
        in_view = sum(abs(ang_diff(b, heading)) <= hfov / 2 - 2 for b in bearings) / len(bearings)
    m["in_view"] = in_view
    if in_view < MIN_IN_VIEW:
        a.rejects.append("face_out_of_frame")
    aim = bearing(mx - cam[0], my - cam[1])
    span = abs(ang_diff(bearings[0], bearings[-1]))
    a.aim = {"bearing": round(aim, 2), "span_deg": round(span, 2),
             "crop_hfov": round(min(100.0, max(40.0, span + 12.0)), 1),
             "rel_to_heading": round(ang_diff(aim, heading), 2)}

    # width the span will occupy in the image stage 2 fetches: a 2048 px thumbnail for
    # perspective frames, the full-resolution original for panoramas
    fetch_w = (frame.get("width") or 2048) if spherical else min(frame.get("width") or 2048, 2048)
    m["span_px"] = px_per_radian(frame, fetch_w) * math.radians(span)
    if m["span_px"] < MIN_SPAN_PX:
        a.rejects.append("face_too_small")
    ppm = px_per_radian(frame) * math.cos(math.radians(min(inc, 89.0))) / max(r, 0.5)
    m["ppm"] = ppm
    if spherical:
        cover_store, cover_full = 1.0, 1.0
    else:
        w, h = frame.get("width") or 4, frame.get("height") or 3
        vhalf = math.atan(math.tan(math.radians(hfov) / 2) * h / w)
        lo, hi = CAMERA_HEIGHT_M - r * math.tan(vhalf), CAMERA_HEIGHT_M + r * math.tan(vhalf)
        cover_store = _overlap((lo, hi), STOREFRONT_BAND) / (STOREFRONT_BAND[1] - STOREFRONT_BAND[0])
        top = max(building_h or 9.0, 4.5)
        cover_full = _overlap((lo, hi), (0.0, top)) / top
    m.update(cover_storefront=cover_store, cover_full=cover_full)

    visible = occlusion_free(cam, face, own, tree, polys or []) if (tree is not None or own is not None) else 1.0
    m["visible"] = visible
    if visible < MIN_VISIBLE:
        a.rejects.append("occluded_by_building")

    now = now or datetime.now(timezone.utc)
    t = _parse_time(frame.get("captured_at"))
    age = (now - t).days / 365.25 if t else 8.0
    m["age_years"] = age
    if t is None:
        a.flags.append("capture_date_unknown")
    era = "unknown"
    since = _parse_time(tenant_since)
    if since and t:
        era = "current_tenant" if t >= since else "pre_tenancy"
    altered = _parse_time(altered_on)
    if altered and t and t < altered:
        a.flags.append("pre_alteration")
    if era == "pre_tenancy":
        a.flags.append("pre_tenancy")
    m["tenant_era"] = era

    if t:
        elev, az = sun.position(t, lat, lon)
        m.update(sun_elev=elev, sun_az=az)
        daylight = 1.0 if elev > 12 else 0.7 if elev > 3 else 0.45 if elev > -6 else 0.2
        glare = elev < 35 and abs(ang_diff(az, aim)) < 35 and elev > -2
        frontlit = abs(ang_diff(az, face.normal_bearing)) < 80 and elev > 5
        lighting = 0.55 if glare else (1.0 if frontlit else 0.85)
        if glare:
            a.flags.append("into_sun")
        if elev < -6:
            a.flags.append("night")
    else:
        daylight, lighting = 0.7, 0.85
    q = frame.get("quality_score")
    qprior = 0.6 + 0.4 * float(q) if q is not None else 0.8
    possrc = 1.0 if frame.get("position_source") in ("sfm",) else 0.85

    s_res = max(0.0, min(1.0, math.log(max(ppm, 1e-3) / PPM_FLOOR) / math.log(PPM_GOOD / PPM_FLOOR)))
    s_inc = math.cos(math.radians(inc))
    s_cover = 0.6 * cover_store + 0.4 * cover_full
    eps = 1e-3

    def geo_mean(parts: dict[str, tuple[float, float]]) -> float:
        tot = sum(w for _, w in parts.values())
        return math.exp(sum(w * math.log(max(v, eps)) for v, w in parts.values()) / tot)

    arch = geo_mean({"res": (s_res, 3), "inc": (0.35 + 0.65 * s_inc, 1.5), "cover": (s_cover, 1.5),
                     "view": (in_view, 1.5), "vis": (visible, 2.5),
                     "recency": (0.5 ** (age / 6.0), 1), "day": (daylight, 1),
                     "light": (lighting, 0.5), "q": (qprior, 1), "pos": (possrc, 1)})
    # signage needs about half the sign floor before it scores at all, full marks at PPM_GOOD
    sign_lo = SIGN_PPM_MIN / 2
    sign_res = max(0.0, min(1.0, math.log(max(ppm, 1e-3) / sign_lo) / math.log(PPM_GOOD / sign_lo)))
    if ppm < SIGN_PPM_MIN:
        a.flags.append("sign_text_unreadable")
    sign = geo_mean({"res": (sign_res, 4), "inc": (s_inc, 2), "cover": (cover_store, 2),
                     "view": (in_view, 1.5), "vis": (visible, 2.5), "day": (daylight, 1),
                     "light": (lighting, 0.5), "q": (qprior, 1), "pos": (possrc, 1)})
    # signs change with tenants and rebrands: age multiplies outright (half-life 4 years)
    # instead of being averaged away; a known tenant start date is handled exactly below
    sign *= 0.5 ** (age / 4.0)
    if era == "pre_tenancy" or "pre_alteration" in a.flags:
        sign = 0.0
    if not a.ok:
        arch = sign = 0.0
    a.scores = {"architecture": arch, "signage": sign, "s_res": s_res, "s_inc": s_inc,
                "s_cover": s_cover, "daylight": daylight, "lighting": lighting}
    a.view = "frontal" if inc < 25 else ("oblique-right" if along > 0 else "oblique-left")
    return a
