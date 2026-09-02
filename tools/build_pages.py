"""Assemble everything GitHub Pages serves.

Pages publishes a directory from the repository, so this is the only place the built app and
the landing page are allowed to live under version control -- build/ is ignored, and an app
nobody can fetch is not a download. Writing the icons, the manifest and the service worker here
too keeps one deploy from ever carrying a manifest that points at an icon from another.
"""
from __future__ import annotations

import hashlib
import json
import pathlib
import shutil
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import make_icons  # noqa: E402
from site_config import APP_URL, REPO, SITE_URL  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "docs"
BUILD = ROOT / "build"


def need(path: pathlib.Path) -> str:
    if not path.exists():
        sys.exit(f"{path.relative_to(ROOT)} is missing. Run the build steps in order.")
    return path.read_text()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    app = need(BUILD / "kerbside-app.html")
    landing = need(BUILD / "landing.html")

    (OUT / "app.html").write_text(app)
    (OUT / "index.html").write_text(landing)

    make_icons.main(OUT)

    manifest = json.loads((ROOT / "tools/pwa/manifest.json").read_text())
    manifest["id"] = f"/{REPO}/"
    (OUT / "manifest.webmanifest").write_text(json.dumps(manifest, indent=2) + "\n")

    # The cache name carries a digest of what is being served. Without it a phone that has
    # already installed the app keeps opening the previous build from its own cache, which looks
    # exactly like a deploy that silently did not happen.
    version = hashlib.blake2b((app + landing).encode(), digest_size=8).hexdigest()
    sw = (ROOT / "tools/pwa/sw.js").read_text().replace("__VERSION__", version)
    (OUT / "sw.js").write_text(sw)

    # Jekyll is on by default for Pages and would refuse to serve anything beginning with an
    # underscore, besides costing a build step this site has no use for.
    (OUT / ".nojekyll").write_text("")

    total = sum(f.stat().st_size for f in OUT.iterdir() if f.is_file())
    print(f"docs/ -> {total / 1e6:.2f} MB, version {version}")
    print(f"  app     {len(app) / 1e6:.2f} MB")
    print(f"  landing {len(landing) / 1e6:.2f} MB")
    print(f"  site    {SITE_URL}")
    print(f"  app url {APP_URL}")


if __name__ == "__main__":
    main()
