"""The phone-side loop, runnable end to end.

    python -m smc.phone ingest  --journal build/phone --limit 200
    python -m smc.phone status  --journal build/phone
    python -m smc.phone batch   --journal build/phone --out build/nightly
    python -m smc.phone schedule

``ingest`` stands in for the glasses feed by reading ordinary photo folders. ``batch`` runs
exactly what fires at 02:00: assess, delete rejects, apply the privacy filter, compress, send,
then delete only what the destination confirmed.

Everything is local. Nothing leaves the machine except what ``batch`` writes to the destination
folder you name.
"""

from __future__ import annotations

import argparse
from datetime import UTC, datetime
from pathlib import Path

from smc.config import Settings
from smc.curate.compress import CompressionProfile, ImageFormat
from smc.ingest.cameraroll import default_sources, ingest, scan
from smc.ingest.daily import BatchPolicy, next_window, run_batch
from smc.ingest.destinations import GcsDestination, build_destination
from smc.ingest.journal import EntryState, LocalPhotoJournal


def _ingest(args: argparse.Namespace) -> int:
    with LocalPhotoJournal(args.journal) as journal:
        if args.dir:
            paths = scan(Path(args.dir), limit=args.limit)
            refused: list[str] = []
        else:
            paths, refused = default_sources(limit_per_root=args.limit)
        if refused:
            print("skipped, permission denied:")
            for path in refused:
                print(f"  {path}")
            print("  (grant Full Disk Access to your terminal to include the Photos library)")
            print()
        if not paths:
            print("no photographs found")
            return 1
        report = ingest(journal, paths, max_edge_px=args.max_edge)
        print(report.describe())
        print(f"journal now holds {journal.count()} frames, {journal.total_bytes() / 1e6:.1f} MB")
    return 0


def _status(args: argparse.Namespace) -> int:
    settings = Settings.from_env()
    with LocalPhotoJournal(args.journal) as journal:
        print(f"journal: {journal.root}")
        print(f"  {journal.count()} frames, {journal.total_bytes() / 1e6:.1f} MB")
        for state in EntryState:
            count = journal.count(state)
            if count:
                print(f"    {state:<14} {count}")
        oldest = journal.oldest_capture()
        if oldest:
            print(f"  oldest capture: {oldest.date()}")
        integrity = journal.verify()
        broken = integrity["rows_without_blobs"] + integrity["blobs_without_rows"]
        print(f"  integrity: {'ok' if broken == 0 else f'{broken} mismatches'}")
        print(f"  next window: {next_window(datetime.now(UTC)).astimezone()}")
        if settings.object_store_url:
            print(f"  destination: {settings.object_store_url}")
    return 0


def _batch(args: argparse.Namespace) -> int:
    # Loads .env.local, so GOOGLE_CLOUD_PROJECT reaches the destination without being exported
    # by whatever launched the job — launchd starts with almost no environment.
    settings = Settings.from_env()
    policy = BatchPolicy(
        max_batch_megabytes=args.budget,
        privacy_filter=not args.no_privacy_filter,
        compression=CompressionProfile(
            format=ImageFormat(args.format), quality=args.quality, max_edge_px=args.max_edge
        ),
    )
    destination = build_destination(
        str(args.out), suffix=args.format, project=settings.google_cloud_project
    )
    if isinstance(destination, GcsDestination):
        ok, message = destination.check_access()
        print(f"destination: gs://{destination.config.bucket}/{destination.config.prefix}")
        if not ok:
            print(f"  unreachable: {message}")
            print("  run `gcloud auth application-default login`, or set")
            print("  GOOGLE_APPLICATION_CREDENTIALS to a service-account key")
            return 2
        print(f"  {message}")
        print()

    with LocalPhotoJournal(args.journal) as journal:
        before = journal.total_bytes()
        report = run_batch(
            journal, destination, policy=policy,
            charging=not args.not_charging, unmetered=not args.metered,
        )
        print(report.describe())
        print()
        print(f"journal: {before / 1e6:.1f} MB -> {journal.total_bytes() / 1e6:.1f} MB")
    return 0


def _schedule(args: argparse.Namespace) -> int:
    now = datetime.now(UTC)
    window = next_window(now)
    print(f"next window: {window.astimezone():%Y-%m-%d %H:%M %Z}")
    print(f"             in {(window - now).total_seconds() / 3600:.1f} hours")
    print()
    print("To run it nightly on this Mac, add a launchd job:")
    print()
    print("  cat > ~/Library/LaunchAgents/com.smc.nightly.plist <<'PLIST'")
    print("  <?xml version=\"1.0\" encoding=\"UTF-8\"?>")
    print("  <plist version=\"1.0\"><dict>")
    print("    <key>Label</key><string>com.smc.nightly</string>")
    print("    <key>ProgramArguments</key><array>")
    print(f"      <string>{Path('.venv/bin/python').resolve()}</string>")
    print("      <string>-m</string><string>smc.phone</string><string>batch</string>")
    print(f"      <string>--journal</string><string>{args.journal.resolve()}</string>")
    print(f"      <string>--out</string><string>{args.out}</string>")
    print("    </array>")
    print("    <key>StartCalendarInterval</key>")
    print("    <dict><key>Hour</key><integer>2</integer>"
          "<key>Minute</key><integer>0</integer></dict>")
    print("  </dict></plist>")
    print("  PLIST")
    print("  launchctl load ~/Library/LaunchAgents/com.smc.nightly.plist")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="smc.phone")
    sub = parser.add_subparsers(dest="command", required=True)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--journal", type=Path, default=Path("build/phone"))

    p_ingest = sub.add_parser("ingest", parents=[common], help="load photographs into the journal")
    p_ingest.add_argument(
        "--dir", type=Path, help="a specific folder; default scans the usual ones"
    )
    p_ingest.add_argument("--limit", type=int, default=None)
    p_ingest.add_argument("--max-edge", type=int, default=2400)

    sub.add_parser("status", parents=[common], help="what is in the journal")

    p_batch = sub.add_parser("batch", parents=[common], help="run the nightly batch now")
    p_batch.add_argument(
        "--out", default="build/nightly",
        help="a local folder, or gs://bucket/prefix",
    )
    p_batch.add_argument("--budget", type=float, default=250.0, help="megabytes")
    p_batch.add_argument("--format", default="avif", choices=[f.value for f in ImageFormat])
    p_batch.add_argument("--quality", type=int, default=72)
    p_batch.add_argument("--max-edge", type=int, default=1440)
    p_batch.add_argument("--no-privacy-filter", action="store_true")
    p_batch.add_argument("--metered", action="store_true")
    p_batch.add_argument("--not-charging", action="store_true")

    p_sched = sub.add_parser("schedule", parents=[common], help="show the nightly schedule")
    p_sched.add_argument("--out", default="build/nightly")

    args = parser.parse_args(argv)
    return {
        "ingest": _ingest, "status": _status, "batch": _batch, "schedule": _schedule
    }[args.command](args)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
