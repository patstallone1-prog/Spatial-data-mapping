"""``smc-cloud``: run the controller or a worker, and operate them.

    smc-cloud controller --config cloud/config/kerbside-cloud.toml
    smc-cloud worker                                  # environment from the boot token
    smc-cloud plan     --cells all --house-batches 50  # submit (idempotent)
    smc-cloud plan     --cells none --interiors --restaurant-rounds 10   # the interior engine
    smc-cloud plan     --cells all --interiors --house-ahead 2 --standing  # kept going daily
    smc-cloud status
    smc-cloud review   list | approve|reject|rerun JOB --reviewer NAME --note WHY
    smc-cloud redo     JOB | --failed-with TEXT [--from-stage colours] --note WHY
    smc-cloud migrate  --private s3://kerbside --cells all --shared all --house-run DIR
    smc-cloud inventory --volume "/Volumes/HP P700 1" --out cloud/docs/inventory.json
    smc-cloud estimate
    smc-cloud gate     CELL                            # the parity gate on a local cell
    smc-cloud release  check | rollback [--to VERSION]
    smc-cloud promote  [--interiors] [--houses] [--open-pr]       # the live release onto the site (manual)
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
from .stages import HOUSE_SAMPLE


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
    if args.interiors or args.houses:
        if not args.private:
            raise SystemExit("--interiors and --houses need --private (or KERBSIDE_PRIVATE_STORE)")
        private = open_store(args.private, role="private")
    if pub is None and private is None:
        raise SystemExit("set --public (or KERBSIDE_PUBLIC_STORE), or pass --interiors or --houses")
    result = promote(args.root, pub, rebuild=not args.no_rebuild,
                     interiors=private if args.interiors else None,
                     houses=private if args.houses else None)
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
    from .controller import Config

    # The loaded config, whose ${...} are filled in from the environment; the raw file's are not.
    cfg = Config.load(args.config)
    private = cfg.private
    state = private.get_json("watchdog/state.json", {}) or {}
    now = time.time()
    try:
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
    woke = None if healthy else wake_controller(cfg, private)
    # The controller's warnings (idle spend, a budget nearly spent: budget.warnings). A new one
    # fails this run, which is how it reaches the owner: GitHub emails a failed scheduled run.
    warnings = []
    if healthy and os.environ.get("KERBSIDE_OPS_TOKEN"):
        try:
            warnings = _ops("/api/status").get("warnings") or []
        except (OSError, ValueError) as exc:
            warnings = [{"key": "status-unreadable", "text": f"status unreadable: {exc}"}]
    # The balance is asked here too: at $0 RunPod deletes the controller, which then warns no one.
    for name, provider in cfg.providers.items():
        try:
            balance = provider.balance()
        except Exception as exc:  # a warning, whatever went wrong
            balance, warnings = None, [*warnings, {"key": f"balance-unknown:{name}", "text": f"{name} balance unknown: {exc}"}]
        if balance is not None and balance < cfg.budget.warn_usd:
            day = time.strftime("%Y-%m-%d", time.gmtime(now))
            warnings.append({"key": f"balance:{day}", "text": f"{name} balance ${balance:.2f}: at $0 every pod is "
                                                               "deleted, the controller's too. Top it up."})
    warnings = list({w["key"]: w for w in warnings}.values())
    reported = set(state.get("warned", []))
    new = [w for w in warnings if w["key"] not in reported]
    state["warned"] = sorted(reported | {w["key"] for w in warnings})[-50:]
    state["last_run"] = now
    state["deleted"] = deleted
    state["wake"] = woke
    private.put_json("watchdog/state.json", state)
    print(json.dumps({"controller_healthy": healthy, "silent_min": round(silent_min),
                      "deleted": deleted, "wake": woke, "warnings": warnings}))
    for w in new:
        print(f"::warning title=Kerbside cloud::{w['text']}")
    return 1 if new else 0


def wake_controller(cfg, private) -> dict:
    """A controller that stopped its own pod for want of work (controller.housekeeping) is
    started again once its queue -- the backup it left -- has work the budget allows."""
    import re
    import sqlite3
    import tempfile

    from .queue import Queue
    from .scheduler import Settings, work_waiting

    match = re.match(r"https://([a-z0-9]+)-\d+\.proxy\.runpod\.net", cfg.url or "")
    provider = cfg.providers.get("runpod")
    if not match or provider is None:
        return {"woke": False, "why": "not a RunPod controller"}
    pod = provider.get(match.group(1))
    status = pod.get("desiredStatus")
    if status != "EXITED":
        return {"woke": False, "why": f"pod is {status}"}
    latest = private.get_json("queue/latest.json")
    if not latest:
        return {"woke": False, "why": "no queue backup"}
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "queue.sqlite"
        private.get_file(latest["key"], db)
        queue = Queue(db)
        try:
            busy, why = work_waiting(queue, Settings(pools=cfg.pools, budget=cfg.budget))
        except sqlite3.Error as exc:
            busy, why = True, f"backup unreadable ({exc}); woken to look"
        finally:
            queue.close()
    if not busy:
        return {"woke": False, "why": why}
    provider.start(match.group(1))
    return {"woke": True, "why": why}


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
    p.add_argument("--house-sample", type=int, default=HOUSE_SAMPLE)
    p.add_argument("--interiors", action="store_true", help="every region's interior engine batches")
    p.add_argument("--restaurant-rounds", type=int, default=0)
    p.add_argument("--house-ahead", type=int, default=0,
                   help="keep this many house batches queued past the last finished")
    p.add_argument("--standing", action="store_true",
                   help="the controller resubmits this plan every replan_h hours")
    sub.add_parser("status")
    r = sub.add_parser("review")
    r.add_argument("action", choices=["list", "approve", "reject", "rerun"])
    r.add_argument("job", nargs="?")
    r.add_argument("--reviewer")
    r.add_argument("--note")
    rq = sub.add_parser("requeue")
    rq.add_argument("job")
    rd = sub.add_parser("redo")
    rd.add_argument("job", nargs="?")
    rd.add_argument("--failed-with", help="every cell whose enrichment failed with this in its log")
    rd.add_argument("--from-stage", default="colours")
    rd.add_argument("--note", required=True)
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
    pr.add_argument("--houses", action="store_true",
                    help="also publish the houses the newest house batch accepted")
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
                "interiors": args.interiors, "restaurant_rounds": args.restaurant_rounds,
                "house_ahead": args.house_ahead, "standing": args.standing}
        print(json.dumps(_ops("/api/plan", body)))
        return 0
    if args.cmd == "status":
        print(json.dumps(_ops("/api/status"), indent=1, default=str))
        return 0
    if args.cmd == "review":
        return cmd_review(args)
    if args.cmd == "redo":
        if not (args.job or args.failed_with):
            raise SystemExit("redo needs JOB or --failed-with")
        body = {"operator": os.environ.get("USER", "ops"), "note": args.note}
        body.update({"failed_with": args.failed_with, "from_stage": args.from_stage} if args.failed_with
                    else {"job": args.job})
        print(json.dumps(_ops("/api/redo", body), indent=1))
        return 0
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
