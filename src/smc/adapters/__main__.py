"""``python -m smc.adapters check`` — report credential state."""

from __future__ import annotations

import argparse

from smc.adapters.credentials import CREDENTIALS, check


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="smc.adapters")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check", help="report which credentials are configured")
    sub.add_parser("list", help="list every service and what it is for")
    args = parser.parse_args(argv)

    if args.command == "list":
        for c in CREDENTIALS:
            safe = "commercial-safe" if c.commercial_safe else "INTERNAL ONLY"
            flag = "required" if c.required else "optional"
            print(f"{c.env_var}")
            print(f"  {c.service}  [{flag}, {safe}]")
            print(f"  {c.purpose}")
            print(f"  {c.where_to_get}")
            print(f"  free tier: {c.free_tier}\n")
        return 0

    report = check()
    print(report.render())
    return 0 if report.ok else 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
