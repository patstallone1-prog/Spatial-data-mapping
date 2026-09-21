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


def point_assets_at(page: str, base: str | None) -> str:
    """The page fetches its data beside itself unless told where else it lives."""
    if not base:
        return page
    return page.replace('<meta name="kerbside-assets" content="" />',
                        f'<meta name="kerbside-assets" content="{base.rstrip("/")}" />', 1)


REGIONS = ROOT / "data" / "regions"


def region_title(entry: dict) -> str:
    return (entry.get("description") or entry["name"]).split(":")[0]


def region_page(entry: dict, site: pathlib.Path) -> str:
    """The current corridor page, named for the region, as scripts/build_sf_corridor_3d.py
    names it. A region's own site/ page is whatever renderer built it last; a deploy that
    copied it shipped eight pages without the region switcher. The page is data-driven and the
    same for every region, so the one in docs/ is the one every region gets."""
    page = need(OUT / "sf-corridor-3d.html")
    page = page.replace("Kerbside SF Corridor 3D", f"Kerbside {region_title(entry)} 3D")
    try:
        ways = json.loads((site / "sf-corridor-3d.json").read_text()).get("ways", [])
        streets = sorted({w.get("name") for w in ways if w.get("kind") == "street" and w.get("name")})
    except (OSError, ValueError):
        streets = []
    hint = " &amp; ".join(streets[:2]) if len(streets) >= 2 else "a corner or an address"
    page = page.replace('placeholder="Columbus &amp; Broadway, or 600 Montgomery"', f'placeholder="{hint}, or an address"', 1)
    return page.replace('<meta name="kerbside-regions" content="regions.json" />',
                        '<meta name="kerbside-regions" content="../../regions.json" />', 1)


def publish_regions(out: pathlib.Path) -> list[dict]:
    """Every region the ingestion has built, beside the corridor, and the index the page's
    region switcher reads.

    A region's site is built into data/regions/<name>/site by scripts/ingest_region.py; the
    page there fetches its data from beside itself, so the folder is copied whole to
    regions/<name>/ and the page inside is told where the site's index lives. A region in the
    registry with no build yet is listed as such, so the switcher says what is coming rather
    than pretending the map is the city.
    """
    registry = json.loads((REGIONS / "regions.json").read_text())["regions"]
    from_journal = {}
    index: list[dict] = [{
        "name": "sf-corridor", "title": "San Francisco: Marina to the Financial District",
        "path": "sf-corridor-3d.html", "built": True,
        "note": "The corridor: the city's kerb lines, the footway survey, the lidar.",
    }]
    for entry in registry:
        name = entry["name"]
        site = REGIONS / name / "site"
        built = (site / "sf-corridor-3d.json").exists() and (site / "sf-corridor-3d.html").exists()
        record = {"name": name, "title": region_title(entry), "path": f"regions/{name}/sf-corridor-3d.html",
                  "built": built, "city": entry.get("city"), "description": entry.get("description")}
        journal = REGIONS / name / "ingest.json"
        if journal.exists():
            stages = json.loads(journal.read_text()).get("stages", {})
            record["stages"] = {k: v.get("status") for k, v in stages.items()}
            built_at = (stages.get("build") or {}).get("finished_at")
            if built_at:
                record["built_at"] = built_at
        caps = REGIONS / name / "capabilities.json"
        if caps.exists():
            activation = json.loads(caps.read_text()).get("activation") or {}
            active = {k: v.get("active") for k, v in activation.items() if isinstance(v, dict)}
            record["active"] = active
            parts = [f"{k} from {v}" for k, v in active.items() if v and v != "none" and k in ("kerbs", "terrain", "building_height")]
            record["note"] = "; ".join(parts) if parts else "built from the map alone"
        if built:
            target = out / "regions" / name
            target.mkdir(parents=True, exist_ok=True)
            for data in sorted(site.iterdir()):
                if data.is_file() and data.suffix in (".json", ".bin"):
                    shutil.copyfile(data, target / data.name)
            page = region_page(entry, site)
            (target / "sf-corridor-3d.html").write_text(page)
            (target / "index.html").write_text(page)
            facades = site / "facades"
            if facades.is_dir():
                shutil.copytree(facades, target / "facades", dirs_exist_ok=True)
        index.append(record)
    (out / "regions.json").write_text(json.dumps({"regions": index}, indent=1) + "\n")
    built = sum(1 for r in index if r["built"])
    print(f"  regions {built} built of {len(index)} listed -> {out.name}/regions/")
    return index


def publish_map(out: pathlib.Path, assets_base: str | None = None) -> None:
    """The 3D corridor on its own, as the front page of wherever it is published.

    A second, otherwise empty repository serves the map by itself. It gets the page and its data
    and nothing else -- no capture app, no landing page, and deliberately no service worker. The
    worker exists to make the capture app installable and to let it open with no signal, neither
    of which is a thing the map needs, and a caching layer is the last thing to add to a site
    somebody has gone looking for because the first one felt slow.
    """
    out.mkdir(parents=True, exist_ok=True)
    page = point_assets_at(need(OUT / "sf-corridor-3d.html"), assets_base)
    # With an assets origin the data is not copied here at all: it is published to object
    # storage by tools/publish_assets.sh and the page fetches it from there. Without one the
    # data sits beside the page, which is what GitHub Pages serves today.
    if not assets_base:
        # The JSON sidecars and the terrain grid's binary: everything the page fetches.
        for data in sorted(OUT.glob("sf-corridor-*")):
            if data.is_file() and data.suffix in (".json", ".bin"):
                shutil.copyfile(data, out / data.name)
        facades = OUT / "facades"
        if facades.is_dir():
            shutil.copytree(facades, out / "facades", dirs_exist_ok=True)
    # index.html and the old name both, so that the short URL works and any link anybody already
    # has to the page by its own name keeps working too.
    (out / "index.html").write_text(page)
    (out / "sf-corridor-3d.html").write_text(page)
    publish_regions(out)
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
    publish_regions(out)

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
    for extra in sorted(out.glob("sf-corridor-*")):
        if not extra.is_file():
            continue
        digest.update(extra.name.encode())
        digest.update(str(extra.stat().st_size).encode())
    # The regions too: a deploy that changed only Oakland's build must still turn the version
    # over, or an installed app keeps serving the old Oakland.
    for extra in sorted(out.glob("regions/*/sf-corridor-3d.*")) + sorted(out.glob("regions.json")):
        if extra.is_file():
            digest.update(str(extra.relative_to(out)).encode())
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
    ap.add_argument("--assets-base", default=None,
                    help="origin the page fetches its data from (an R2/S3 bucket's public URL). "
                         "The JSON and facades are then not copied into --out; publish them "
                         "with tools/publish_assets.sh.")
    args = ap.parse_args()
    if args.map_only:
        publish_map(args.out or OUT, args.assets_base)
    else:
        main(args.out)
