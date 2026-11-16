#!/usr/bin/env python3
"""Verified exterior editors: accounts whose saved edits change the world everyone sees.

Every device makes its own account (docs/kerbside-account.mjs) and registers it, unverified,
under its name -- there is no code to hand out and nothing to type. Verify one on the backend:

    editor_accounts.py --verify "Coral Heron 47"   # prints the SQL line to run in Supabase
    editor_accounts.py --unverify "Coral Heron 47"

(or tick ``verified`` on its row in kerbside_editors). The name is the one the editor and the
home screen show for that device. ``--make NAME`` still makes an old-style key and private link
for a device that cannot reach the store to register.

A player who logs in (supabase/kerbside_login.sql) is verified by username instead, on every
device they log in on; and since there is no email, a forgotten password is reset here:

    editor_accounts.py --verify-login coral.heron
    editor_accounts.py --reset-password coral.heron   # prints the SQL and a new password to pass on
"""

from __future__ import annotations

import argparse
import hashlib
import secrets
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = "https://spatial-data-mapping.vercel.app/app-model.html"
KEYS = ROOT / "build" / "editor-keys"


def sql_line(name: str, key: str) -> str:
    digest = hashlib.sha256(key.encode()).hexdigest()
    quoted = name.replace("'", "''")
    return (f"insert into kerbside_editors (key_sha256, name) values ('{digest}', '{quoted}') "
            "on conflict (key_sha256) do update set name = excluded.name, verified = true;")


def verify_line(name: str, verified: bool = True) -> str:
    """The line that marks the device account called ``name`` verified (or not)."""
    quoted = name.replace("'", "''")
    return f"update kerbside_editors set verified = {'true' if verified else 'false'} where name = '{quoted}';"


def login_verify_line(username: str, verified: bool = True) -> str:
    """The line that marks the logged-in account ``username`` verified (or not), on all its devices."""
    quoted = username.strip().lower().replace("'", "''")
    return f"update kerbside_accounts set verified = {'true' if verified else 'false'} where lower(username) = '{quoted}';"


def reset_password_line(username: str) -> tuple[str, str]:
    """A new password for ``username`` and the line that sets it (stored only as its bcrypt hash)."""
    password = secrets.token_urlsafe(9)
    quoted = username.strip().lower().replace("'", "''")
    return (f"update kerbside_accounts set password_hash = extensions.crypt('{password}', extensions.gen_salt('bf', 10)) "
            f"where lower(username) = '{quoted}';"), password


def make(name: str) -> tuple[str, Path]:
    key = secrets.token_urlsafe(32)
    KEYS.mkdir(parents=True, exist_ok=True)
    path = KEYS / f"{''.join(c if c.isalnum() else '-' for c in name.lower())}.txt"
    path.write_text(f"Kerbside verified editor: {name}\nOpen this link once on each device you edit from:\n"
                    f"{SITE}#editor-key={key}\n\nOr paste this key into the editor's Verify box:\n{key}\n")
    path.chmod(0o600)
    return sql_line(name, key), path


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--verify", metavar="NAME", help="the SQL that verifies the account of that name")
    group.add_argument("--unverify", metavar="NAME", help="the SQL that stops that account writing")
    group.add_argument("--make", metavar="NAME", help="an old-style key and private link")
    group.add_argument("--verify-login", metavar="USERNAME", help="the SQL that verifies a logged-in account")
    group.add_argument("--unverify-login", metavar="USERNAME", help="the SQL that stops a logged-in account writing")
    group.add_argument("--reset-password", metavar="USERNAME", help="a new password and the SQL that sets it")
    args = parser.parse_args()
    if args.make:
        line, path = make(args.make)
        print(line)
        print(f"-- private link written to {path} (not printed here)")
    elif args.verify_login or args.unverify_login:
        print(login_verify_line(args.verify_login or args.unverify_login, bool(args.verify_login)))
    elif args.reset_password:
        line, password = reset_password_line(args.reset_password)
        print(line)
        print(f"-- the new password to give {args.reset_password.strip()}: {password}")
    else:
        print(verify_line(args.verify or args.unverify, bool(args.verify)))
