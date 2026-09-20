#!/usr/bin/env python3
"""Render unreal/Kerbside/Config/DefaultEngine.ini from .env.local.

The Epic Online Services credentials -- product, sandbox and deployment ids, and the client
id and secret -- live in .env.local with every other credential this project uses, and never
in git. This fills the template with them so the Unreal project opens already pointed at the
Kerbside product; the rendered file is ignored by git.

    set -a; source .env.local; set +a; python tools/unreal/write_config.py
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / "unreal" / "Kerbside" / "Config"
NEEDED = ("EOS_PRODUCT_NAME", "EOS_PRODUCT_ID", "EOS_SANDBOX_ID", "EOS_DEPLOYMENT_ID",
          "EOS_CLIENT_ID", "EOS_CLIENT_SECRET")


def main() -> int:
    template = (CONFIG / "DefaultEngine.ini.template").read_text()
    missing = [name for name in NEEDED if not os.environ.get(name)]
    if missing:
        print(f"not set in the environment (source .env.local first): {', '.join(missing)}", file=sys.stderr)
        if "EOS_CLIENT_ID" in missing or "EOS_CLIENT_SECRET" in missing:
            print("create a Client in the EOS Developer Portal (Product Settings > Clients, policy "
                  "'Peer2Peer' for a game client) and put its id and secret in .env.local",
                  file=sys.stderr)
        return 1
    rendered = re.sub(r"\$\{(\w+)\}", lambda m: os.environ[m.group(1)], template)
    (CONFIG / "DefaultEngine.ini").write_text(rendered)
    print(f"wrote {CONFIG / 'DefaultEngine.ini'} for product {os.environ['EOS_PRODUCT_NAME']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
