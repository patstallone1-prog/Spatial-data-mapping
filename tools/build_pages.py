"""Assemble everything GitHub Pages serves.

Pages publishes a directory from the repository, so this is the only place the built app and
the landing page are allowed to live under version control -- build/ is ignored, and an app
nobody can fetch is not a download. Writing the icons, the manifest and the service worker here
too keeps one deploy from ever carrying a manifest that points at an icon from another.
"""
from __future__ import annotations

import argparse
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


def publish_map(out: pathlib.Path) -> None:
    """The 3D corridor on its own, as the front page of wherever it is published.

    A second, otherwise empty repository serves the map by itself. It gets the page and its data
    and nothing else -- no capture app, no landing page, and deliberately no service worker. The
    worker exists to make the capture app installable and to let it open with no signal, neither
    of which is a thing the map needs, and a caching layer is the last thing to add to a site
    somebody has gone looking for because the first one felt slow.
    """
    out.mkdir(parents=True, exist_ok=True)
    page = need(OUT / "sf-corridor-3d.html")
    for data in sorted(OUT.glob("sf-corridor-*")):
        if data.is_file() and data.suffix == ".json":
            shutil.copyfile(data, out / data.name)
    facades = OUT / "facades"
    if facades.is_dir():
        shutil.copytree(facades, out / "facades", dirs_exist_ok=True)
    # index.html and the old name both, so that the short URL works and any link anybody already
    # has to the page by its own name keeps working too.
    (out / "index.html").write_text(page)
    (out / "sf-corridor-3d.html").write_text(page)
    make_icons.main(out)
    (out / ".nojekyll").write_text("")
    total = sum(f.stat().st_size for f in out.iterdir() if f.is_file())
    print(f"{out.name}/ -> {total / 1e6:.2f} MB, map only")
    print(f"  site    {SITE_URL}")


def main(out: pathlib.Path | None = None) -> None:
    # The same deploy, aimed somewhere else. The site is also published from a second, otherwise
    # empty repository, and a copy made by hand goes stale the first time only one of them is
    # rebuilt -- so the mirror is a target of this script rather than a directory somebody
    # remembered to sync. The data files come from the canonical docs/ because that is where the
    # corridor build writes them, and the digest below has to see them to version the cache.
    out = out or OUT
    out.mkdir(parents=True, exist_ok=True)
    if out != OUT:
        # Every corridor file, not only the data: the standalone 3D page is one of them,
        # and a mirror without it serves a landing page that links to nothing.
        for data in sorted(OUT.glob("sf-corridor-*")):
            if data.is_file():
                shutil.copyfile(data, out / data.name)
        for extra in ("facades",):
            source = OUT / extra
            if source.is_dir():
                shutil.copytree(source, out / extra, dirs_exist_ok=True)

    app = need(BUILD / "kerbside-app.html")
    landing = need(BUILD / "landing.html")

    (out / "app.html").write_text(app)
    (out / "index.html").write_text(landing)

    make_icons.main(out)

    manifest = json.loads((ROOT / "tools/pwa/manifest.json").read_text())
    manifest["id"] = f"/{REPO}/"
    (out / "manifest.webmanifest").write_text(json.dumps(manifest, indent=2) + "\n")

    # The cache name carries a digest of what is being served. Without it a phone that has
    # already installed the app keeps opening the previous build from its own cache, which looks
    # exactly like a deploy that silently did not happen.
    # Everything served, not only the two pages built here. The digest used to cover app.html
    # and the landing page alone, so a deploy that changed nothing but the 3D map's data left
    # the version identical, the old cache alive, and the new payload unreachable on any device
    # that had opened the site before.
    digest = hashlib.blake2b(digest_size=8)
    digest.update((app + landing).encode())
    for extra in sorted(out.glob("sf-corridor-3d.*")):
        digest.update(extra.name.encode())
        digest.update(str(extra.stat().st_size).encode())
    version = digest.hexdigest()
    sw = (ROOT / "tools/pwa/sw.js").read_text().replace("__VERSION__", version)
    (out / "sw.js").write_text(sw)

    # Jekyll is on by default for Pages and would refuse to serve anything beginning with an
    # underscore, besides costing a build step this site has no use for.
    (out / ".nojekyll").write_text("")

    total = sum(f.stat().st_size for f in out.iterdir() if f.is_file())
    print(f"{out.name}/ -> {total / 1e6:.2f} MB, version {version}")
    print(f"  app     {len(app) / 1e6:.2f} MB")
    print(f"  landing {len(landing) / 1e6:.2f} MB")
    print(f"  site    {SITE_URL}")
    print(f"  app url {APP_URL}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--map-only", action="store_true",
                    help="publish the 3D corridor by itself, as index.html, without the "
                         "capture app, the landing page or the service worker.")
    ap.add_argument("--out", type=pathlib.Path, default=None,
                    help="publish into this directory instead of docs/. Set GITHUB_REPO to "
                         "match the repository it will be served from, or every link in the "
                         "manifest and the service worker will point back at the other site.")
    args = ap.parse_args()
    if args.map_only:
        publish_map(args.out or OUT)
    else:
        main(args.out)
