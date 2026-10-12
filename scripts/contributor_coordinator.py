#!/usr/bin/env python3
"""Hand photographs to contributors' machines and bring their results home.

The filter here screens about 3,700 photographs an hour. Family Macs running the contributor
(contrib/kerbside_contributor.py) screen more in parallel. This is the Mac's side of it, through
the Supabase functions in supabase/kerbside_contributors.sql:

  hand out   while a contributor has checked in within ACTIVE_MINUTES, the queue there is kept
             QUEUE_PER_CONTRIBUTOR deep with the best photographs the filter has not screened;
             each is listed in the filter's contrib-assigned.json so it is not screened twice
  collect    every PULL_HOURS (12) the results come home: each screened photograph, with its
             crop and segmentation, goes into the filter's photo bucket like its own, and the
             matcher fits it on its next pass; then the results are cleared from Supabase
  take back  if no contributor has checked in for a day, the queued work is withdrawn and the
             filter here screens it

    contributor_coordinator.py --setup-sql            # token lines to paste after the schema
    contributor_coordinator.py --make-bundle "Mom"    # a private bundle for one Mac (has the keys)
    contributor_coordinator.py --status               # what is queued, who is contributing
    contributor_coordinator.py --watch-seconds 600    # the loop (the supervisor runs it)
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import secrets
import sqlite3
import sys
import time
import urllib.error
import urllib.request
import uuid
import zipfile
from datetime import UTC, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV = ROOT / ".env.local"
SUPABASE_URL = "https://tpbugonqwaoxtcswxyki.supabase.co"
ACTIVE_MINUTES = 30
QUEUE_PER_CONTRIBUTOR = 400
PULL_HOURS = 12
WITHDRAW_AFTER_HOURS = 24
BUNDLE_PATHS = ("src", "scripts/filter_frontage_photos.py", "contrib", "pyproject.toml", "LICENSE")


def env(name: str) -> str | None:
    if os.environ.get(name):
        return os.environ[name]
    for line in ENV.read_text().splitlines() if ENV.exists() else []:
        if line.startswith(f"{name}="):
            return line.split("=", 1)[1].strip().strip('"')
    return None


def publishable_key() -> str:
    page = (ROOT / "docs/app.html").read_text()
    start = page.index("sb_publishable_")
    end = start
    while end < len(page) and (page[end].isalnum() or page[end] in "_-"):
        end += 1
    return page[start:end]


def ensure_tokens() -> tuple[str, str]:
    """The coordinator's and the contributors' tokens, made once and kept in .env.local."""
    coordinator, contributor = env("KERBSIDE_COORDINATOR_TOKEN"), env("KERBSIDE_CONTRIBUTOR_TOKEN")
    if not coordinator or not contributor:
        coordinator = coordinator or secrets.token_urlsafe(32)
        contributor = contributor or secrets.token_urlsafe(32)
        with ENV.open("a") as fh:
            fh.write(f"\nKERBSIDE_COORDINATOR_TOKEN={coordinator}\nKERBSIDE_CONTRIBUTOR_TOKEN={contributor}\n")
    return coordinator, contributor


def rpc(name: str, body: dict, timeout: int = 60):
    key = publishable_key()
    request = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/rpc/{name}", data=json.dumps(body).encode(), method="POST",
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read() or b"null")


class Coordinator:
    def __init__(self, filter_output: Path, token: str):
        self.out = filter_output
        self.token = token
        self.state_path = filter_output / "contrib-state.json"
        self.assigned_path = filter_output / "contrib-assigned.json"
        try:
            self.state = json.loads(self.state_path.read_text())
        except (OSError, ValueError):
            self.state = {"last_pull": None, "last_result_id": 0}

    def save(self) -> None:
        tmp = self.state_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.state, indent=1))
        os.replace(tmp, self.state_path)

    def assigned(self) -> set[tuple]:
        try:
            return {tuple(k) for k in json.loads(self.assigned_path.read_text())["keys"]}
        except (OSError, ValueError, KeyError):
            return set()

    def write_assigned(self, keys: set[tuple]) -> None:
        tmp = self.assigned_path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"at": datetime.now(UTC).isoformat(), "keys": sorted(keys)}))
        os.replace(tmp, self.assigned_path)

    def unscreened(self, limit: int, skip: set[tuple]) -> list[dict]:
        """The best photographs the filter has indexed and not yet screened, as work items."""
        seen = set()
        for path in (self.out / "review").glob("*.json"):
            try:
                r = json.loads(path.read_text())
                seen.add((r["region"], str(r["building_id"]),
                          r["candidate"]["observation"]["observation_uid"]))
            except (OSError, ValueError, KeyError, TypeError):
                continue
        try:
            summaries = json.loads((self.out / "status.json").read_text()).get("regions") or []
        except (OSError, ValueError):
            summaries = []
        found = []
        for summary in summaries:
            if summary.get("status") != "indexed":
                continue
            with sqlite3.connect(Path(summary["folder"]) / "selection.sqlite") as conn:
                for (text,) in conn.execute("SELECT payload FROM buildings"):
                    row = json.loads(text)
                    for candidate in row.get("candidates") or []:
                        key = (summary["region"], str(row["building_id"]),
                               candidate["observation"]["observation_uid"])
                        if key in seen or key in skip:
                            continue
                        found.append((candidate.get("pose_status") == "provider_solved", candidate["rank"],
                                      key, {k: v for k, v in row.items() if k != "candidates"},
                                      candidate, summary["region"], summary["run"]))
                        break
        found.sort(key=lambda f: (f[0], *f[1]), reverse=True)
        return [{"work_key": "|".join(key), "payload": {"row": row, "candidate": candidate,
                                                        "region": region, "run_id": run}}
                for _, _, key, row, candidate, region, run in found[:limit]]

    def cycle(self, force_pull: bool = False) -> dict:
        status = rpc("kerbside_status", {"token": self.token})
        now = datetime.now(UTC)
        active = [c for c in status["contributors"]
                  if now - datetime.fromisoformat(c["last_seen"]) < timedelta(minutes=ACTIVE_MINUTES)]
        report = {"contributors_active": len(active), "work": status["work"],
                  "results_waiting": status["results_waiting"]}
        assigned = self.assigned()
        queued = status["work"].get("queued", 0)
        if active and queued < QUEUE_PER_CONTRIBUTOR * len(active):
            items = self.unscreened(QUEUE_PER_CONTRIBUTOR * len(active) - queued, assigned)
            for start in range(0, len(items), 100):
                rpc("kerbside_enqueue", {"token": self.token, "items": items[start:start + 100]}, timeout=120)
            assigned |= {tuple(i["work_key"].split("|")) for i in items}
            report["handed_out"] = len(items)
        last_seen = max((datetime.fromisoformat(c["last_seen"]) for c in status["contributors"]), default=None)
        if assigned and (last_seen is None or now - last_seen > timedelta(hours=WITHDRAW_AFTER_HOURS)):
            back = rpc("kerbside_withdraw", {"token": self.token}) or []
            assigned -= {tuple(k.split("|")) for k in back}
            report["taken_back"] = len(back)
        last_pull = self.state.get("last_pull")
        if force_pull or last_pull is None or now - datetime.fromisoformat(last_pull) >= timedelta(hours=PULL_HOURS):
            collected = self.collect(assigned)
            report["collected"] = collected
            self.state["last_pull"] = now.isoformat()
        self.write_assigned(assigned)
        self.save()
        return report

    def collect(self, assigned: set[tuple]) -> int:
        review = self.out / "review"
        review.mkdir(parents=True, exist_ok=True)
        count, upto = 0, self.state.get("last_result_id", 0)
        while True:
            rows = rpc("kerbside_pull", {"token": self.token, "after_id": upto, "how_many": 200}, timeout=180)
            if not rows:
                break
            for row in rows:
                upto = max(upto, row["id"])
                assigned.discard(tuple(str(row["work_key"]).split("|")))
                result = row["payload"]
                report = result.get("review")
                if result.get("outcome") == "error" or not isinstance(report, dict) or not report.get("review_key"):
                    continue
                key = report["review_key"]
                for suffix, data in (result.get("files") or {}).items():
                    (review / f"{key}.{suffix}").write_bytes(base64.b64decode(data))
                if (review / f"{key}.jpg").exists():
                    report["crop"] = str(review / f"{key}.jpg")
                report["contributed_by"] = result.get("device_name")
                tmp = review / f"{key}.json.tmp"
                tmp.write_text(json.dumps(report, default=str, indent=2))
                os.replace(tmp, review / f"{key}.json")
                count += 1
            self.state["last_result_id"] = upto
            self.save()
            rpc("kerbside_ack", {"token": self.token, "upto_id": upto})
        return count


def make_bundle(name: str, contributor_token: str, folder: Path) -> Path:
    """A zip for one Mac: the code it runs, its settings (with the keys) and an installer to
    double-click. It holds keys: send it to that person directly, never post it."""
    device = str(uuid.uuid4())
    config = {"name": name, "device_id": device, "supabase_url": SUPABASE_URL,
              "publishable_key": publishable_key(), "contributor_token": contributor_token,
              "mapillary_token": env("MAPILLARY_TOKEN") or env("MAPILLARY_ACCESS_TOKEN")}
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / f"kerbside-contributor-{name.lower().replace(' ', '-')}.zip"
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as bundle:
        for entry in BUNDLE_PATHS:
            path = ROOT / entry
            files = [path] if path.is_file() else [p for p in path.rglob("*") if p.is_file()
                                                    and "__pycache__" not in p.parts]
            for file in files:
                bundle.write(file, f"kerbside-contributor/app/{file.relative_to(ROOT)}")
        bundle.writestr("kerbside-contributor/config.json", json.dumps(config, indent=1))
        info = zipfile.ZipInfo("kerbside-contributor/Install Kerbside Contributor.command")
        info.external_attr = 0o755 << 16
        bundle.writestr(info, (ROOT / "contrib/install-mac.sh").read_text())
        info = zipfile.ZipInfo("kerbside-contributor/Stop Kerbside Contributor.command")
        info.external_attr = 0o755 << 16
        bundle.writestr(info, (ROOT / "contrib/stop-mac.sh").read_text())
    os.chmod(target, 0o600)
    return target


def main() -> int:
    global ENV
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--filter-output", type=Path, default=ROOT / "build/frontage-live")
    ap.add_argument("--setup-sql", action="store_true")
    ap.add_argument("--make-bundle", metavar="NAME")
    ap.add_argument("--bundle-folder", type=Path, default=ROOT / "build/contrib")
    ap.add_argument("--status", action="store_true")
    ap.add_argument("--pull-now", action="store_true")
    ap.add_argument("--watch-seconds", type=int, default=0)
    ap.add_argument("--env-file", type=Path, default=ENV, help="where the tokens and keys are kept")
    args = ap.parse_args()
    ENV = args.env_file
    coordinator_token, contributor_token = ensure_tokens()
    if args.setup_sql:
        for kind, token in (("coordinator", coordinator_token), ("contributor", contributor_token)):
            digest = hashlib.sha256(token.encode()).hexdigest()
            print(f"insert into kerbside_settings (key, value) values ('{kind}_token_sha256', '{digest}') "
                  "on conflict (key) do update set value = excluded.value;")
        return 0
    if args.make_bundle:
        print(make_bundle(args.make_bundle, contributor_token, args.bundle_folder))
        return 0
    if args.status:
        print(json.dumps(rpc("kerbside_status", {"token": coordinator_token}), indent=1))
        return 0
    coordinator = Coordinator(args.filter_output, coordinator_token)
    while True:
        try:
            print(json.dumps({"at": datetime.now(UTC).isoformat(), **coordinator.cycle(args.pull_now)}), flush=True)
        except (urllib.error.URLError, urllib.error.HTTPError, OSError, ValueError, KeyError) as error:
            # Before the schema is pasted, or offline: say so, and try again next time.
            print(json.dumps({"at": datetime.now(UTC).isoformat(), "waiting": type(error).__name__,
                              "detail": str(error)[:200]}), flush=True)
        if not args.watch_seconds:
            return 0
        time.sleep(args.watch_seconds)


if __name__ == "__main__":
    sys.exit(main())
