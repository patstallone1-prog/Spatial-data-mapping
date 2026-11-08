"""Write the generated app pages into docs/ for a deploy (Vercel's build command).

The pages, the release manifest and the service worker are made from the renderer's source
and are not kept in the repository; the data they point at is. Standard library only: the
build machine has Python and none of the data pipeline's packages.

    python3 tools/build_deploy_pages.py
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from smc.renderer.pages import DOCS, write_app_pages  # noqa: E402


def main() -> int:
    started = time.monotonic()
    published = write_app_pages(DOCS)
    print(f"deploy pages: docs/app-model.html and {published} regional viewers, "
          f"runtime-release.json, sw.js in {time.monotonic() - started:.1f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
