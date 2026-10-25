"""``smc-cloud``: run the controller or a worker, and operate them.

    smc-cloud controller --config cloud/config/kerbside-cloud.toml
    smc-cloud worker                                  # environment from the boot token
    smc-cloud plan     --cells all --house-batches 50  # submit (idempotent)
    smc-cloud plan     --cells none --interiors --restaurant-rounds 10   # the interior engine
    smc-cloud status
    smc-cloud review   list | approve|reject|rerun JOB --reviewer NAME --note WHY
    smc-cloud migrate  --private s3://kerbside --cells all --shared all --house-run DIR
    smc-cloud inventory --volume "/Volumes/HP P700 1" --out cloud/docs/inventory.json
    smc-cloud estimate
    smc-cloud gate     CELL                            # the parity gate on a local cell
    smc-cloud release  check | rollback [--to VERSION]
    smc-cloud promote  [--interiors] [--open-pr]       # the live release onto the site (manual)
    smc-cloud watchdog --config ...                    # the independent fail-safe
    smc-cloud selftest                                 # the whole lifecycle, locally
    smc-cloud runpod-controller keys|plan|storage|check|create|status|stop|start   # its pod

Operator commands talk to the controller at ``KERBSIDE_CONTROLLER`` (or ``KERBSIDE_CONTROLLER_URL``,
as controller.env sets it) with ``KERBSIDE_OPS_TOKEN``.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import signal
import sys
import time
import urllib.request
from pathlib import Path

from . import USER_AGENT


def _ops(path: str, body: dict | None = None) -> dict:
    # controller.env names it KERBSIDE_CONTROLLER_URL, the controller's own setting.
    base = (os.environ.get("KERBSIDE_CONTROLLER")
            or os.environ.get("KERBSIDE_CONTROLLER_URL", "")).rstrip("/")
    token = os.environ.get("KERBSIDE_OPS_TOKEN", "")
    if not base or not token:
        raise SystemExit("set KERBSIDE_CONTROLLER and KERBSIDE_OPS_TOKEN")
    req = urllib.request.Request(base + path, method="POST" if body is not None else "GET",
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Bearer {token}",
                                          "Content-Type": "application/json",
                                          "User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())


def cmd_controller(args) -> int:
    from .controller import Config, Controller

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    ctl = Controller(Config.load(args.config))
    port = ctl.start(args.port, args.host)
    logging.getLogger("kerbside").info("controller on port %s", port)
    done = {"stop": False}

    def stop(*_):
        done["stop"] = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    while not done["stop"]:
        time.sleep(1)
    ctl.shutdown(stop_workers=False)  # workers keep their leases; a new controller picks up
    return 0


def cmd_review(args) -> int:
    if args.action == "list":
        for held in _ops("/api/status")["held"]:
            print(f"{held['id']}\n  " + "\n  ".join(held["reasons"]))
        return 0
    if not (args.job and args.reviewer and args.note):
        raise SystemExit("approve/reject/rerun need JOB, --reviewer and --note")
    print(json.dumps(_ops("/api/review", {"job": args.job, "decision": args.action,
                                          "reviewer": args.reviewer, "note": args.note})))
    return 0


def cmd_release(args) -> int:
    from .publish import Publisher
    from .store import open_store

    pub = Publisher(open_store(args.public, role="public"), args.base)
    if args.action == "check":
        missing = pub.check_live()
        print(json.dumps({"live": (pub.pointer()[0] or {}).get("version"), "missing": missing}))
        return 1 if missing else 0
    print(json.dumps(pub.rollback(args.to, reason=args.reason)))
    return 0


def cmd_promote(args) -> int:
    """Lay the live release out for the site in this checkout. Without ``--open-pr`` it stops
    there (review the diff); with it, commits the small files and opens an auto-merge PR, which
    deploys once CI passes -- the owner's call, never the controller's."""
    from .publish import Publisher
    from .site import open_pull_request, promote
    from .store import open_store

    pub = Publisher(open_store(args.public, role="public"), args.base) if args.public else None
    private = None
    if args.interiors:
        if not args.private:
            raise SystemExit("--interiors needs --private (or KERBSIDE_PRIVATE_STORE)")
        private = open_store(args.private, role="private")
    if pub is None and private is None:
        raise SystemExit("set --public (or KERBSIDE_PUBLIC_STORE), or pass --interiors")
    result = promote(args.root, pub, rebuild=not args.no_rebuild, interiors=private)
    if result.get("changed") and args.open_pr:
        token = os.environ.get("GITHUB_TOKEN", "")
        if not token:
            raise SystemExit("set GITHUB_TOKEN (fine-grained: this repository, contents + pull requests)")
        result["pull_request"] = open_pull_request(args.root, result["paths"], version=result["version"],
                                                   slug=args.repo, token=token)
    print(json.dumps(result, indent=1))
    return 0


def cmd_watchdog(args) -> int:
    """Outside the controller (a scheduled GitHub Actions job): delete every worker instance if
    the controller has not answered for ``--grace-min``, and any instance older than
    ``--max-hours`` whatever the controller says. The last line of defence against a bill."""
    import tomllib

    from .controller import Config
    from .store import open_store

    raw = tomllib.loads(Path(args.config).read_text())
    cfg = Config.load(args.config)
    private = open_store(raw["stores"]["private"], role="private")
    state = private.get_json("watchdog/state.json", {}) or {}
    now = time.time()
    try:
        # cfg.url, not the raw file's: that still reads ${KERBSIDE_CONTROLLER_URL}.
        req = urllib.request.Request(f"{cfg.url.rstrip('/')}/healthz",
                                     headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=20) as r:
            healthy = r.status == 200
    except (OSError, ValueError):
        healthy = False
    if healthy:
        state["last_healthy"] = now
    silent_min = (now - state.get("last_healthy", now)) / 60
    deleted = []
    for name, provider in cfg.providers.items():
        for inst in provider.list():
            age_h = (now - inst.created_at) / 3600
            if silent_min > args.grace_min or age_h > args.max_hours:
                provider.terminate(inst.id)
                deleted.append({"provider": name, "id": inst.id, "worker": inst.worker_id,
                                "age_h": round(age_h, 2), "controller_silent_min": round(silent_min)})
    state["last_run"] = now
    state["deleted"] = deleted
    private.put_json("watchdog/state.json", state)
    print(json.dumps({"controller_healthy": healthy, "silent_min": round(silent_min), "deleted": deleted}))
    return 0


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    ap = argparse.ArgumentParser(prog="smc-cloud", description="Kerbside's cloud processing")
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("controller")
    c.add_argument("--config", type=Path, default=Path(os.environ.get("KERBSIDE_CONFIG", "cloud/config/kerbside-cloud.toml")))
    c.add_argument("--port", type=int, default=int(os.environ.get("KERBSIDE_PORT", "8080")))
    c.add_argument("--host", default="0.0.0.0")
    sub.add_parser("worker")
    p = sub.add_parser("plan")
    p.add_argument("--cells", default="all")
    p.add_argument("--house-batches", type=int, default=0)
    p.add_argument("--house-sample", type=int, default=24)
    p.add_argument("--interiors", action="store_true", help="every region's interior engine batches")
    p.add_argument("--restaurant-rounds", type=int, default=0)
    sub.add_parser("status")
    r = sub.add_parser("review")
    r.add_argument("action", choices=["list", "approve", "reject", "rerun"])
    r.add_argument("job", nargs="?")
    r.add_argument("--reviewer")
    r.add_argument("--note")
    rq = sub.add_parser("requeue")
    rq.add_argument("job")
    sub.add_parser("migrate", add_help=False)
    sub.add_parser("inventory", add_help=False)
    sub.add_parser("runpod-controller", add_help=False)
    e = sub.add_parser("estimate")
    e.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[3])
    rel = sub.add_parser("release")
    rel.add_argument("action", choices=["check", "rollback"])
    rel.add_argument("--public", default=os.environ.get("KERBSIDE_PUBLIC_STORE", ""))
    rel.add_argument("--base", default=os.environ.get("KERBSIDE_PUBLIC_BASE", ""))
    rel.add_argument("--to")
    rel.add_argument("--reason", default="operator rollback")
    pr = sub.add_parser("promote")
    pr.add_argument("--public", default=os.environ.get("KERBSIDE_PUBLIC_STORE", ""))
    pr.add_argument("--base", default=os.environ.get("KERBSIDE_PUBLIC_BASE", ""))
    pr.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[3])
    pr.add_argument("--repo", default="patstallone1-prog/Spatial-data-mapping")
    pr.add_argument("--no-rebuild", action="store_true")
    pr.add_argument("--interiors", action="store_true",
                    help="also publish the collected interiors and restaurant rounds")
    pr.add_argument("--private", default=os.environ.get("KERBSIDE_PRIVATE_STORE", ""))
    pr.add_argument("--open-pr", action="store_true")
    w = sub.add_parser("watchdog")
    w.add_argument("--config", type=Path, required=True)
    w.add_argument("--grace-min", type=float, default=60)
    w.add_argument("--max-hours", type=float, default=30)
    g = sub.add_parser("gate")
    g.add_argument("cell")
    g.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[3])
    sub.add_parser("selftest")
    if argv and argv[0] in ("migrate", "inventory", "runpod-controller"):
        module = __import__(f"smc.cloud.{argv[0].replace('-', '_')}", fromlist=["main"])
        return module.main(argv[1:])
    args = ap.parse_args(argv)
    if args.cmd == "controller":
        return cmd_controller(args)
    if args.cmd == "worker":
        from .worker import main as worker_main

        return worker_main()
    if args.cmd == "plan":
        cells = None if args.cells == "all" else [] if args.cells == "none" else args.cells.split(",")
        body = {"cells": cells,
                "house_batches": args.house_batches, "house_sample": args.house_sample,
                "interiors": args.interiors, "restaurant_rounds": args.restaurant_rounds}
        print(json.dumps(_ops("/api/plan", body)))
        return 0
    if args.cmd == "status":
        print(json.dumps(_ops("/api/status"), indent=1, default=str))
        return 0
    if args.cmd == "review":
        return cmd_review(args)
    if args.cmd == "requeue":
        print(json.dumps(_ops("/api/requeue", {"job": args.job, "operator": os.environ.get("USER", "ops")})))
        return 0
    if args.cmd == "estimate":
        from .estimate import report

        print(json.dumps(report(args.root), indent=1))
        return 0
    if args.cmd == "release":
        return cmd_release(args)
    if args.cmd == "promote":
        return cmd_promote(args)
    if args.cmd == "watchdog":
        return cmd_watchdog(args)
    if args.cmd == "gate":
        from .gate import evaluate
        from .stages import CELL_CHAIN

        verdict = evaluate(args.root, args.cell, CELL_CHAIN)
        print(json.dumps(verdict, indent=1))
        return 0 if verdict["decision"] == "pass" else 3
    if args.cmd == "selftest":
        from .selftest import run

        result = run()
        print(json.dumps(result, indent=1, default=str))
        return 0 if result["ok"] else 1
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
