"""``kerbfront opus-run``: Marina restaurants read by Claude Opus 5.5, in parallel shards.

The queue is :func:`.flow.eligible` cut to the Marina (the ``marina`` box, not the Union
Street corridor) without the five reviewed restaurants, which are examples. Before any spend a
restaurant must have at least two clean views (:func:`.opus.clean_views`); the wall's metric
elevation is added when it covers enough of the wall. Output: ``models/auto-opus/<id>.json``
and ``observations/auto-opus/<id>.json`` (the studio lists them as ``opus~<id>``), and the
inputs as sent in ``out/auto/<id>/opus-in-w<edge>.jpg``.
"""

from __future__ import annotations

import copy
import json
import time
import traceback

import cv2
import numpy as np

from ..config import AREAS, LAB, OUT
from . import opus as O
from . import qwen as Q
from .flow import _since, eligible
from .run import WORK, elevations

REVIEWED = ("tacolicious", "super-duper-burgers", "balboa-cafe", "a16", "dragon-well")
OBS = LAB / "observations" / "auto-opus"
MODELS = LAB / "models" / "auto-opus"
LOG = O.DIR / "run.log"
MIN_COVER = 0.55


def _log(msg: str) -> None:
    LOG.parent.mkdir(parents=True, exist_ok=True)
    line = f"{time.strftime('%H:%M:%S')} {msg}"
    print(line, flush=True)
    with LOG.open("a") as f:
        f.write(line + "\n")


def marina_queue(include_reviewed: bool = False, kinds: str = "restaurant") -> list[dict]:
    todo, _ = eligible("marina-union", kinds)
    box = AREAS["marina"]
    biz = {z["id"]: z for z in json.loads((OUT / "marina-union" / "businesses.json").read_text())}
    reviewed = {json.loads(p.read_text())["business_id"] for p in (LAB / "models").glob("*.json") if p.stem in REVIEWED}
    out = []
    for b in todo:
        z = biz.get(b["id"]) or {}
        pos = z.get("position") or {}
        if b["corridor"] == "union" or not pos or not box.contains(pos["lat"], pos["lon"]):
            continue
        if b["id"] in reviewed and not include_reviewed:
            continue
        out.append(b)
    return out


def _overlay(base: dict, e: int, fused: np.ndarray, grid: list, L: float, top: float, ans: dict) -> np.ndarray:
    from ..observe import _set
    from .sheet import draw
    r = O.sanitize(ans, base, e)
    m = copy.deepcopy(base)
    for row in O.to_observations(base, e, r, [], "check"):
        _set(m, row["path"], row["value"])
    img = draw(np.clip(fused, 0, 255).astype(np.uint8), m, e, grid, "your parts over the rectified elevation")
    return Q.grid_image(img.astype(np.float32), grid, L, top)


HOUSE_USES = ("single family", "two family", "dwelling")


def corner_walls(base: dict, e: int, tenant: dict | None = None, min_len: float = 5.0, most: int = 2) -> list[int]:
    """A corner building's other street walls, the one that meets the tenant's end of the front
    first (wall e runs from vertex e to vertex e+1, so its end meets wall e+1, its start wall e-1)."""
    n = len(base["walls"])
    st = base["walls"][e].get("street")
    ok = [i for i, w in enumerate(base["walls"]) if i != e and w.get("role") == "street" and w.get("street")
          and w.get("street") != st and w["length_m"] >= min_len]
    if tenant is not None:
        L = base["walls"][e]["length_m"]
        near = (e + 1) % n if (tenant["u0"] + tenant["u1"]) / 2 > L / 2 else (e - 1) % n
        ok.sort(key=lambda i: (i != near, -base["walls"][i]["length_m"]))
    else:
        ok.sort(key=lambda i: -base["walls"][i]["length_m"])
    return ok[:most]


def _read(biz, base, e, views, ok, since, budget, check, extra=None):
    """One wall: images and facts built, Opus asked (or the cache), the reading sanitized.
    Returns (rows, info) or (None, skip reason)."""
    mid = base["id"]
    L = float(base["walls"][e]["length_m"])
    top = max(base["height_m"], 4.0)
    whole = O.whole_wall_view(base, e, ok, top)
    if whole is not None:  # first: it sets the rhythm the closer views fill in
        views = [whole] + [v for v in views if v["frame_id"] != whole["frame_id"]][:3]
    pairs = [(v, O.render_view(v, top)) for v in views]
    views = [v for v, im in pairs if im is not None]
    imgs = [im for _, im in pairs if im is not None]
    if not imgs:
        return None, "photos: no view close enough to read"
    grid_img, chk, frames = None, None, [v["frame_id"] for v in views]
    el = elevations(base, e, {}, log=lambda *a: None)
    if el.get("used"):
        fused, seen, labels, g, planes, ref = el["_wall"]
        grid = [g.u0, g.u1, g.v0, g.v1, g.px, g.L]
        cs = slice(max(0, int((0 - g.u0) * g.px)), int((L - g.u0) * g.px))
        rs = slice(max(0, int((g.v1 - min(top, 7.0)) * g.px)), int((g.v1 - 0.3) * g.px))
        cover = float(seen[rs, cs].mean()) if seen[rs, cs].size else 0.0
        if cover >= MIN_COVER:
            grid_img = Q.grid_image(fused, grid, L, top, seen)
            frames = sorted(set(frames) | set(el.get("frames") or []))
            if check:
                chk = lambda ans: _overlay(base, e, fused, grid, L, top, ans)  # noqa: E731
        else:
            _log(f"  {biz['name']}: wall {e} elevation covers {cover:.0%}, photos only")
    if len(imgs) < 2 and grid_img is None:
        return None, "photos: one readable view and no usable elevation"
    images = ([grid_img] if grid_img is not None else []) + imgs
    text = O.facts(base, e, views, since, grid_img is not None, O.qwen_hint(mid, e), extra=extra)
    (WORK / mid).mkdir(parents=True, exist_ok=True)
    wmax = max(i.shape[1] for i in images)
    cv2.imwrite(str(WORK / mid / f"opus-in-w{e}.jpg"),
                np.vstack([cv2.resize(i, (wmax, int(i.shape[0] * wmax / i.shape[1]))) for i in images]),
                [cv2.IMWRITE_JPEG_QUALITY, 80])
    (WORK / mid / f"opus-in-w{e}.txt").write_text(text)
    rec = O.read_wall(images, text, f"{mid}:w{e}", budget, log=_log, check=chk)
    if rec is None:
        return None, "opus: no usable answer"
    r = O.sanitize(rec["answer"], base, e)
    how = f"kerbfront opus ({O.MODEL}, effort {O.EFFORT}{', checked' if chk else ''}): wall {e}, {len(views)} clean views" + \
          (" + metric elevation" if grid_img is not None else "")
    rows = O.to_observations(base, e, r, frames, how)
    info = {"wall": e, "views": len(views), "elevation": grid_img is not None, "notes": r["notes"],
            "dropped": r["dropped"],
            "parts": sum(len(v) for v in r["wall"].values() if isinstance(v, list)) + len(r["storefronts"])}
    return rows, info


def one(biz: dict, budget: float, check: bool = True, corners: bool = False) -> dict:
    from ..model import build, photos_for
    from ..observe import _set, apply_observations

    try:
        base = build(biz["id"])
    except SystemExit as e:
        return {"skip": f"model: {e}"}
    if any(h in str((base.get("facts") or {}).get("use") or "").lower() for h in HOUSE_USES):
        return {"skip": f"building: {(base.get('facts') or {}).get('use')} (a house)"}
    mid = base["id"]
    base["photos"] = photos_for(base, limit=8)
    since = _since(biz["id"])
    ok = O.ok_frames(biz["id"], base.get("corridor"))
    views = O._choose(ok, since, 4)
    if not views:
        return {"skip": "photos: no clean view"}
    mine = [s for s in base["storefronts"] if s.get("business_id") == base.get("business_id")] or base["storefronts"]
    if not mine:
        return {"skip": "model: no storefront"}
    e = mine[0]["edge"]
    s0 = O.spent()
    rows, info = _read(biz, base, e, views, ok, since, budget, check)
    if rows is None:
        return {"skip": info}
    walls = [info]
    seen_shop = any(s.get("visible") is not False and s.get("business_id") == base.get("business_id")
                    for r in rows if r["path"] == "storefronts" for s in r["value"])
    for e2 in (corner_walls(base, e, mine[0]) if corners and seen_shop else []):
        cur = copy.deepcopy(base)
        for r in rows:
            _set(cur, r["path"], r["value"])
        ok2, cur["photos"] = O.wall_frames(cur, e2, since=since)
        views2 = O._choose(ok2, since, 4)
        if views2:
            w = base["walls"]
            extra = (f"This is the building's other street side ({w[e2].get('street')}). The tenant asked about has its "
                     f"main front on wall {e} ({w[e].get('street')}), read already: its shop may turn the corner onto "
                     f"this wall, or this wall may hold other shops, entrances to flats, or plain wall. Read what is "
                     f"here; give the building's height, floors and roof as on the main front.")
            rows2, info2 = _read(biz, cur, e2, views2, ok2, since, budget, check, extra=extra)
            if rows2 is not None:
                # the main front sets height, floors and roof; the side adds its wall, shops and street things
                rows += [r for r in rows2 if r["path"] not in ("height_m", "floors", "roof.cornice", "roof.parapet_h")]
                base["photos"] = cur["photos"]
                walls.append(info2)
            else:
                _log(f"  {biz['name']}: corner wall {e2}: {info2}")
        else:
            _log(f"  {biz['name']}: corner wall {e2}: no clean view")
    how = "; ".join(f"wall {w['wall']}: {w['views']} views" for w in walls)
    OBS.mkdir(parents=True, exist_ok=True)
    path = OBS / f"{mid}.json"
    path.write_text(json.dumps({"model": mid, "read_by": f"kerbfront opus ({O.MODEL}, effort {O.EFFORT}): {how}",
                                "notes": " | ".join(w["notes"] for w in walls),
                                "dropped": [d for w in walls for d in w["dropped"]], "observations": rows},
                               indent=1, default=str))
    apply_observations(base, path)
    MODELS.mkdir(parents=True, exist_ok=True)
    (MODELS / f"{mid}.json").write_text(json.dumps(base, indent=1, default=str))
    return {"model": mid, "wall": e, "walls": [w["wall"] for w in walls], "views": walls[0]["views"],
            "elevation": walls[0]["elevation"], "parts": sum(w["parts"] for w in walls),
            "dropped": sum(len(w["dropped"]) for w in walls), "cost": round(O.spent() - s0, 4),
            "kind": biz.get("kind")}


def _state_path(shard, tag: str = ""):
    return O.DIR / (f"state{tag}.json" if shard is None else f"state{tag}-{shard[0]}of{shard[1]}.json")


def run(budget: float = 60.0, limit: int | None = None, shard: tuple[int, int] | None = None,
        ids: list[str] | None = None, check: bool = True, retail: bool = False, corners: bool = False) -> dict:
    if not O.has_key():
        raise SystemExit("ANTHROPIC_API_KEY missing: add it to storefronts-lab/.env.local")
    todo = marina_queue(include_reviewed=bool(ids), kinds="retail" if retail else "restaurant")
    if ids:
        want = [i.lower() for i in ids]
        todo = [b for b in todo if b["id"].lower() in want or (b["name"] or "").lower() in want]
    if shard is not None:
        todo = todo[shard[0]::shard[1]]
    p = _state_path(shard, ("-retail" if retail else "") + ("-corners" if corners else ""))
    st = json.loads(p.read_text()) if p.exists() and not ids else {"done": {}, "skipped": {}}
    tag = f"[{shard[0]}/{shard[1]}] " if shard else ""
    _log(f"{tag}Marina queue {len(todo)} restaurant walls; Opus spend so far ${O.spent():.2f}, cap ${budget:.2f}")
    n = 0
    for biz in todo:
        if biz["id"] in st["done"] or biz["id"] in st["skipped"]:
            continue
        if limit is not None and n >= limit:
            break
        n += 1
        t0 = time.time()
        try:
            res = one(biz, budget, check=check, corners=corners)
        except O.BudgetSpent as e:
            _log(f"{tag}stopped: {e}")
            break
        except Exception as e:  # noqa: BLE001
            res = {"skip": f"error: {type(e).__name__}: {e}"}
            _log(traceback.format_exc(limit=4))
        res["seconds"] = round(time.time() - t0)
        if "skip" in res:
            st["skipped"][biz["id"]] = {"name": biz["name"], **res}
            _log(f"{tag}skip {biz['name']}: {res['skip']}")
        else:
            st["done"][biz["id"]] = {"name": biz["name"], **res}
            _log(f"{tag}done {biz['name']} -> models/auto-opus/{res['model']}.json {res['parts']} parts "
                 f"${res['cost']:.3f} {res['seconds']} s (total ${O.spent():.2f})")
        if not ids:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps(st, indent=1))
    return {"done": len(st["done"]), "skipped": len(st["skipped"]), "spent": round(O.spent(), 3)}


def dry(ids: list[str] | None = None, limit: int | None = None, retail: bool = False, corners: bool = False) -> dict:
    """The inputs for each restaurant as they would be sent (images + facts), with no call:
    ``out/auto/<id>/opus-in-w<edge>.jpg`` and ``.txt``. Counts who would be skipped and why."""
    todo = marina_queue(include_reviewed=bool(ids), kinds="retail" if retail else "restaurant")
    if ids:
        want = [i.lower() for i in ids]
        todo = [b for b in todo if b["id"].lower() in want or (b["name"] or "").lower() in want]
    real = O.read_wall
    sent, why = [], {}
    O.read_wall = lambda images, text, tag, budget, log=print, check=None: (  # noqa: E731
        sent.append({"tag": tag, "images": len(images), "chars": len(text)}) and None)
    try:
        for b in todo[:limit]:
            res = one(b, 0.0, check=False, corners=corners)
            k = res.get("skip", "?").split(":")[0] + ": " + res.get("skip", "?").split(":", 1)[-1].strip()[:40]
            why[k] = why.get(k, 0) + 1
    finally:
        O.read_wall = real
    return {"queue": len(todo), "would_send": len(sent), "sent": sent[:10], "outcomes": why}
