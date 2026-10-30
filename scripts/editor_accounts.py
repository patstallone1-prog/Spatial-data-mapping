#!/usr/bin/env python3
"""Make a verified exterior editor: someone whose saved edits change the world everyone sees.

    editor_accounts.py --make "Larry"     # a new key; prints the SQL line, writes the private link

The key never goes into the database or the repository: the SQL line stores its SHA-256
(supabase/kerbside_exterior_edits.sql checks a key against it), and the key itself is written
only into a private link under build/editor-keys/, which the editor opens once on each device
(docs/kerbside-account.mjs reads it and takes it out of the address bar). To revoke a key:
``update kerbside_editors set verified = false where name = '...';``
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
    parser.add_argument("--make", metavar="NAME", required=True)
    args = parser.parse_args()
    line, path = make(args.make)
    print(line)
    print(f"-- private link written to {path} (not printed here)")
