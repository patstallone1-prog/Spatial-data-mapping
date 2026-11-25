"""CLI: ``python -m kerbfront {sweep,photos,pixels,handoff,model,studio}`` (run from storefronts-lab/)."""

from __future__ import annotations

import argparse
import json


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="kerbfront")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("sweep", help="gather + merge business, building and face data")
    s.add_argument("--area", default="marina-union")
    p = sub.add_parser("photos", help="stage 1: geometric frame filter + shot lists")
    p.add_argument("--area", default="marina-union")
    p.add_argument("--corridor")
    p.add_argument("--source", choices=("live", "catalogue"), default="live")
    x = sub.add_parser("pixels", help="stage 2: thumbnail + segmentation checks, contact sheets")
    x.add_argument("--area", default="marina-union")
    x.add_argument("--corridor")
    x.add_argument("--limit", type=int, default=40)
    x.add_argument("--restaurants", action="store_true",
                   help="only the restaurants the Qwen flow can take (no limit), all their picks")
    h = sub.add_parser("handoff", help="write smc.exteriors input programs for swept buildings")
    h.add_argument("--area", default="marina-union")
    h.add_argument("--corridor")
    m = sub.add_parser("model", help="build an editable building model for a storefront business")
    m.add_argument("business", nargs="+", help="business name(s) or id(s)")
    m.add_argument("--area", default="marina-union")
    m.add_argument("--no-photos", action="store_true")
    r = sub.add_parser("rectify", help="photos re-projected onto a model wall (measured elevations)")
    r.add_argument("model")
    r.add_argument("--wall", type=int)
    r.add_argument("--photos", type=int, nargs="*")
    r.add_argument("--res", type=int, default=40)
    r.add_argument("--offset", type=float, default=0.0, help="plane offset from the wall (m)")
    r.add_argument("--u", type=float, nargs=2, help="only this stretch of the wall (m)")
    al = sub.add_parser("align", help="correct a photo's camera pose against a model wall")
    al.add_argument("model")
    al.add_argument("photo", type=int)
    al.add_argument("--du", type=float, default=0.0)
    al.add_argument("--dn", type=float, default=0.0)
    al.add_argument("--wall", type=int)
    for k in ("dyaw", "dpitch", "dfov", "dz"):
        al.add_argument(f"--{k}", type=float)
    mp = sub.add_parser("more-photos", help="add frames aimed at another wall of a model")
    mp.add_argument("model")
    mp.add_argument("--wall", type=int, required=True)
    mp.add_argument("--u", type=float, nargs=2)
    mp.add_argument("-k", type=int, default=4)
    sk = sub.add_parser("stack", help="rectified photos stacked over the studio's wall render")
    sk.add_argument("model")
    sk.add_argument("--wall", type=int, required=True)
    sk.add_argument("--photos", type=int, nargs="*", default=[])
    sk.add_argument("--snap", help="name of a studio snap in out/snaps/")
    sk.add_argument("--u", type=float, nargs=2)
    au = sub.add_parser("auto", help="read a model's walls from its photos with no reviewer (models/auto/)")
    au.add_argument("model", nargs="+")
    au.add_argument("--fresh", action="store_true", help="rebuild the registered elevations")
    sc = sub.add_parser("score", help="automatic vs reviewed model, part by part (kerbfront.auto.score)")
    sc.add_argument("model", nargs="+")
    qr = sub.add_parser("qwen-run", help="read eligible restaurants' facades with Qwen (one worker, budget cap)")
    qr.add_argument("--budget", type=float, default=3.0, help="stop when OpenRouter spend reaches this (USD)")
    qr.add_argument("--limit", type=int, default=None, help="restaurants to try this run")
    qr.add_argument("--shard", help="i/n: this worker takes every n-th restaurant from the i-th")
    qr.add_argument("--only", nargs="+", help="a test batch: these restaurants (names or ids), in order")
    qr.add_argument("--deep", action="store_true", help="add an oblique photo and ask for depths (models/auto-deep)")
    qr.add_argument("--effort", choices=("low", "medium", "high"), help="let the model reason at this effort")
    op = sub.add_parser("opus-run", help="read Marina restaurants' facades with Claude Opus 5.5 (budget cap, shards)")
    op.add_argument("--budget", type=float, default=60.0, help="stop when Anthropic spend reaches this (USD)")
    op.add_argument("--limit", type=int, default=None, help="restaurants to try this run")
    op.add_argument("--shard", help="i/n: this worker takes every n-th restaurant from the i-th")
    op.add_argument("--only", nargs="+", help="a test batch: these restaurants (names or ids)")
    op.add_argument("--no-check", action="store_true", help="skip the correction turn over the drawn parts")
    op.add_argument("--dry", action="store_true", help="build and save the inputs, call nothing")
    st = sub.add_parser("studio", help="serve the building studio (view + edit models)")
    st.add_argument("--port", type=int, default=8791)
    a = ap.parse_args(argv)
    if a.cmd == "sweep":
        from .sweep import run
        res = run(a.area)
        res.pop("provenance", None)
    elif a.cmd == "photos":
        from .photos.run import run_geometry
        res = run_geometry(a.area, a.corridor, a.source)
    elif a.cmd == "pixels":
        from .photos.run import run_pixels
        if a.restaurants:
            from .auto.flow import candidates
            res = run_pixels(a.area, a.corridor, 10_000, per_business=8,
                             only=candidates(a.area, a.corridor))
        else:
            res = run_pixels(a.area, a.corridor, a.limit)
    elif a.cmd == "model":
        from .model import build, photos_for, write
        from .observe import apply_observations
        res = {}
        for name in a.business:
            mdl = build(name, a.area)
            if not a.no_photos:
                mdl["photos"] = photos_for(mdl, a.area)
            apply_observations(mdl)
            res[mdl["id"]] = str(write(mdl))
    elif a.cmd == "rectify":
        from .photos.rectify import run as rect
        res = rect(a.model, a.wall, a.photos, a.res, a.offset, tuple(a.u) if a.u else None)
    elif a.cmd == "align":
        from .photos.rectify import set_align
        res = set_align(a.model, a.photo, a.du, a.dn, a.wall, dyaw=a.dyaw, dpitch=a.dpitch, dfov=a.dfov, dz=a.dz)
    elif a.cmd == "more-photos":
        from .model import MODELS, photos_for_wall
        mpath = MODELS / f"{a.model}.json"
        mdl = json.loads(mpath.read_text())
        added = photos_for_wall(mdl, a.wall, tuple(a.u) if a.u else None, a.k)
        mpath.write_text(json.dumps(mdl, indent=1))
        res = [(p["slot"], p["captured_at"], p["camera_type"]) for p in added]
    elif a.cmd == "stack":
        from .photos.stack import stack
        res = stack(a.model, a.wall, a.photos, a.snap, urange=tuple(a.u) if a.u else None)
    elif a.cmd == "auto":
        from .auto.run import auto
        res = {m: auto(m, reuse=not a.fresh) for m in a.model}
    elif a.cmd == "score":
        from .auto.score import score
        res = {}
        for m in a.model:
            r = score(m)
            res[m] = {"agreement": r["agreement"], "passed": r["passed"], "checks": r["checks"],
                      "failed": [f"{c['check']} (wall {c['edge']})" for c in r["detail"] if not c["pass"]]}
    elif a.cmd == "qwen-run":
        from .auto.flow import run as qrun
        shard = tuple(int(x) for x in a.shard.split("/")) if a.shard else None
        res = qrun(a.budget, a.limit, shard=shard, ids=a.only, deep=a.deep, effort=a.effort)
    elif a.cmd == "opus-run":
        shard = tuple(int(x) for x in a.shard.split("/")) if a.shard else None
        if a.dry:
            from .auto.opus_flow import dry
            res = dry(a.only, a.limit)
        else:
            from .auto.opus_flow import run as orun
            res = orun(a.budget, a.limit, shard=shard, ids=a.only, check=not a.no_check)
    elif a.cmd == "studio":
        from .studio import serve
        serve(a.port)
        return
    else:
        from .handoff import run
        res = run(a.area, a.corridor)
    print(json.dumps(res, indent=1, default=str))


if __name__ == "__main__":
    main()
