"""Run the photo filters over a swept area.

    python -m kerbfront photos --area marina-union --corridor chestnut           # stage 1
    python -m kerbfront pixels --area marina-union --corridor chestnut --limit 40 # stage 2

Stage 1 assesses every frame within range of each storefront's own frontage (its tenant span
of the street face, not the whole building edge). Stage 2 downloads the shortlisted frames'
2048 px thumbnails and segmentation, re-scores them, writes face crops and contact sheets.
"""

from __future__ import annotations

import json
import math
import unicodedata
from collections import Counter, defaultdict
from dataclasses import replace
from pathlib import Path

import cv2
import numpy as np
from shapely.strtree import STRtree

from ..config import AREAS, OUT
from ..faces import Face, buildings_from_datasf
from ..geo import Frame, unit
from ..sources import datasf, mapillary
from .geometry import MAX_RANGE_M, assess
from .pixels import MIN_FACE_PX, assess_pixels
from .selection import select


def _load(area: str):
    out = OUT / area
    biz = json.loads((out / "businesses.json").read_text())
    fj = json.loads((out / "faces.json").read_text())
    frame = Frame(*fj["frame_origin"])
    faces = {}
    for d in fj["faces"]:
        d = dict(d)
        d["p0"], d["p1"] = tuple(d["p0"]), tuple(d["p1"])
        faces[d["id"]] = Face(**d)
    bfacts = json.loads((out / "buildings.json").read_text())
    return out, biz, faces, frame, bfacts


def span_face(face: Face, span: list[float] | None, biz_id: str) -> Face:
    if not span:
        return face
    tx, ty = unit(face.p1[0] - face.p0[0], face.p1[1] - face.p0[1])
    u0, u1 = span
    if u1 - u0 < 1.0:  # keep at least a metre either side of a pinched span
        c = (u0 + u1) / 2
        u0, u1 = max(0.0, c - 1.0), min(face.length_m, c + 1.0)
    p0 = (face.p0[0] + tx * u0, face.p0[1] + ty * u0)
    p1 = (face.p0[0] + tx * u1, face.p0[1] + ty * u1)
    return replace(face, id=f"{face.id}@{biz_id}", p0=p0, p1=p1, length_m=u1 - u0)


def targets(biz: list[dict], corridor: str | None, min_likelihood: float = 0.5) -> list[dict]:
    return [z for z in biz if z.get("face") and z["storefront_likelihood"] >= min_likelihood
            and (corridor is None or z.get("corridor") == corridor)]


def frames_for(area: str, source: str = "live") -> tuple[list[dict], dict]:
    b = AREAS[area]
    return mapillary.frames_live(b) if source == "live" else mapillary.frames_catalogue(b)


def run_geometry(area: str = "marina-union", corridor: str | None = None,
                 source: str = "live") -> dict:
    out, biz, faces, frame, bfacts = _load(area)
    frames, fprov = frames_for(area, source)
    xy = np.array([frame.xy(f["lon"], f["lat"]) for f in frames]) if frames else np.zeros((0, 2))
    fp_rows, _ = datasf.footprints(AREAS[area])
    buildings = {bd.id: bd for bd in buildings_from_datasf(fp_rows, frame)}
    polys = [bd.poly for bd in buildings.values()]
    tree = STRtree(polys)
    fmeta = {f["id"]: f for f in frames}
    results = []
    totals: Counter = Counter()
    for z in targets(biz, corridor):
        base = faces[z["face"]["id"]]
        sub = span_face(base, z["face"].get("tenant_span_m"), z["id"])
        bd = buildings.get(base.building_id)
        mx, my = sub.mid
        near = np.where(np.hypot(xy[:, 0] - mx, xy[:, 1] - my) <= MAX_RANGE_M + 5)[0] if len(xy) else []
        since = (z["fields"].get("location_start_date") or {}).get("value")
        rows = []
        rejects: Counter = Counter()
        for i in near:
            f = frames[i]
            a = assess(sub, f, tuple(xy[i]), building_h=bd.height_m if bd else None,
                       own=bd.poly if bd else None, tree=tree, polys=polys, tenant_since=since,
                       altered_on=z.get("last_exterior_change"),
                       lat=z["position"]["lat"], lon=z["position"]["lon"])
            j = a.to_json()
            rows.append(j)
            rejects.update(a.rejects or ["ok"])
        totals.update(rejects)
        picks = select(rows, fmeta)
        for p in picks:
            fm = fmeta[p["frame_id"]]
            p["frame"] = {k: fm.get(k) for k in ("captured_at", "camera_type", "width", "height",
                                                 "hfov", "sequence", "heading", "position_source")}
        results.append({"business": z["id"], "name": (z["fields"].get("name") or {}).get("value"),
                        "address": z.get("address"), "corridor": z.get("corridor"),
                        "face": sub.id, "street": base.street, "span_m": z["face"].get("tenant_span_m"),
                        "candidates": len(rows), "passed": rejects.get("ok", 0),
                        "rejects": dict(rejects), "picks": picks,
                        "near_misses": sorted([r for r in rows if not r["ok"] and r["metrics"]["range_m"] < 25
                                               and len(r["rejects"]) == 1],
                                              key=lambda r: r["metrics"]["range_m"])[:3]})
    summary = {"area": area, "corridor": corridor, "frames": len(frames), "frame_source": fprov,
               "businesses": len(results),
               "with_picks": sum(1 for r in results if r["picks"]),
               "with_sign_shot": sum(1 for r in results if any(p["slot"] == "sign" for p in r["picks"])),
               "reject_reasons": dict(totals)}
    tag = corridor or "all"
    (out / f"photos_{tag}.json").write_text(json.dumps({"summary": summary, "results": results}, default=str))
    return summary


def run_pixels(area: str = "marina-union", corridor: str | None = None, limit: int = 40,
               per_business: int = 5, size: int = 2048, only: set[str] | None = None) -> dict:
    out, biz, faces, frame, bfacts = _load(area)
    tag = corridor or "all"
    data = json.loads((out / f"photos_{tag}.json").read_text())
    bymap = {z["id"]: z for z in biz}
    frames, _ = frames_for(area)
    fmeta = {f["id"]: f for f in frames}
    fxy = {f["id"]: frame.xy(f["lon"], f["lat"]) for f in frames}
    rows = [r for r in data["results"] if r["picks"] and (only is None or r["business"] in only)]
    rows.sort(key=lambda r: -len(r["picks"]))
    done, verdicts = [], Counter()
    for r in rows[:limit]:
        z = bymap[r["business"]]
        base = faces[z["face"]["id"]]
        sub = span_face(base, z["face"].get("tenant_span_m"), z["id"])
        bh = (bfacts.get(base.building_id) or {}).get("height_m")
        px = []
        for p in r["picks"][:per_business] + r.get("near_misses", [])[:1]:
            fid = p["frame_id"]
            # the sign slot of a panorama needs the full-resolution original: a 2048 px
            # equirectangular thumbnail spends only ~6 px per degree on the facade
            pano = fmeta[fid].get("camera_type") == "spherical"
            small = p["metrics"].get("span_px_2048", 1e9) < 1.5 * MIN_FACE_PX
            want = "original" if pano and (p.get("slot") == "sign" or small) else size
            try:
                img = mapillary.thumbnail(fid, want)
                dets = mapillary.detections(fid)
            except Exception as e:  # noqa: BLE001 - a missing thumbnail is a per-frame outcome
                px.append({"frame_id": fid, "error": str(e)[:200]})
                continue
            res = assess_pixels(fmeta[fid], sub, fxy[fid], bh, img, dets,
                                crop_out=out / "crops" / r["business"] / f"{fid}.jpg")
            res["slot"] = p.get("slot", "near-miss")
            res["geometry_ok"] = p["ok"]
            res["geometry_rejects"] = p["rejects"]
            res["geometry_scores"] = p["scores"]
            res["captured_at"] = fmeta[fid].get("captured_at")
            verdicts.update(res["rejects"] or (["ok"] if p["ok"] else ["geometry-reject"]))
            px.append(res)
        r["pixels"] = px
        pscore = {(x["frame_id"], r["face"]): x["score"] for x in px if "score" in x}
        cands = [p for p in r["picks"]]
        r["final"] = select(cands, fmeta, k=per_business, pixel_scores=pscore)
        sheet(r, out / "sheets" / f"{r['business']}.jpg")
        done.append(r)
    summary = {"area": area, "corridor": corridor, "businesses": len(done),
               "pixel_verdicts": dict(verdicts)}
    (out / f"pixels_{tag}.json").write_text(json.dumps({"summary": summary, "results": done}, default=str))
    return summary


def sheet(r: dict, dest: Path, cell: tuple[int, int] = (480, 360)) -> None:
    """Contact sheet: each crop with slot, verdict, scores and capture date."""
    tiles = []
    for x in r.get("pixels", []):
        if not x.get("crop"):
            continue
        img = cv2.imread(x["crop"])
        if img is None:
            continue
        h, w = img.shape[:2]
        s = min(cell[0] / w, cell[1] / h)
        img = cv2.resize(img, (max(1, int(w * s)), max(1, int(h * s))))
        canvas = np.full((cell[1] + 54, cell[0], 3), 24, np.uint8)
        canvas[:img.shape[0], :img.shape[1]] = img
        verdict = ",".join(x["rejects"] + x.get("geometry_rejects", [])) or "KEEP"
        lines = [f"{x['slot']}  {verdict}  px={x.get('score', 0):.2f} sign={x.get('score_sign', 0):.2f}",
                 f"{(x.get('captured_at') or '')[:10]}  arch={x['geometry_scores'].get('architecture', 0):.2f}"
                 f" lap={x['metrics'].get('laplacian_var', 0):.0f} occ={x['metrics'].get('occluded_storefront', 0):.2f}"]
        for i, t in enumerate(lines):
            cv2.putText(canvas, t, (6, cell[1] + 20 + 22 * i), cv2.FONT_HERSHEY_SIMPLEX, 0.5,
                        (90, 220, 90) if verdict == "KEEP" else (80, 80, 240), 1, cv2.LINE_AA)
        tiles.append(canvas)
    if not tiles:
        return
    cols = 3
    rows = math.ceil(len(tiles) / cols)
    H, W = tiles[0].shape[:2]
    board = np.full((rows * H + 40, cols * W, 3), 12, np.uint8)
    for i, t in enumerate(tiles):
        y, xx = divmod(i, cols)
        board[40 + y * H:40 + (y + 1) * H, xx * W:(xx + 1) * W] = t
    title = f"{r.get('name')}  |  {(r.get('address') or {}).get('number', '')} {(r.get('address') or {}).get('street', '')}"
    title = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode()  # Hershey fonts are ASCII
    cv2.putText(board, title[:90], (8, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.75, (240, 240, 240), 2, cv2.LINE_AA)
    dest.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(dest), board, [cv2.IMWRITE_JPEG_QUALITY, 82])
