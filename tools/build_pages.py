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
from site_config import APP_URL, SITE_PATH, SITE_URL  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "docs"
BUILD = ROOT / "build"



def copy_if_newer(source: pathlib.Path, target: pathlib.Path) -> bool:
    """Publish a region's data file unless what is already published is newer.

    The local region builds under data/regions/ are not versioned, and one can be older than
    what another checkout built and committed to docs/ -- copying it over wholesale reverted a
    published ground-cover fix. A region rebuilt here is newer than its published copy and
    still goes out; an old local copy no longer overwrites newer published work.
    """
    if target.exists() and target.stat().st_mtime >= source.stat().st_mtime:
        return False
    shutil.copy2(source, target)
    return True

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


def region_build_ready(site: pathlib.Path, published: pathlib.Path) -> bool:
    """A viewer-only refresh may use the large payload already published in docs."""
    return (site / "sf-corridor-3d.html").exists() and (
        (site / "sf-corridor-3d.json").exists()
        or (published / "sf-corridor-3d.json").exists())


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
    corridor_bbox = json.loads((OUT / "sf-corridor-3d.json").read_text()).get("bbox") if (OUT / "sf-corridor-3d.json").exists() else None
    index: list[dict] = [{
        "name": "sf-corridor", "title": "San Francisco: Marina to the Financial District",
        "path": "sf-corridor-3d.html", "built": True,
        "note": "The corridor: the city's kerb lines, the footway survey, the lidar.",
        "bbox": [corridor_bbox["south"], corridor_bbox["west"], corridor_bbox["north"], corridor_bbox["east"]] if corridor_bbox else None,
    }]
    for entry in registry:
        name = entry["name"]
        site = REGIONS / name / "site"
        # A shipped region can keep its large, previously published payload in
        # docs while a viewer-only rebuild updates the source HTML.  Requiring
        # the JSON to be duplicated under data/regions marked every Bay Area
        # city "not built" and hid its full-detail handoff after that rebuild.
        published = out / "regions" / name
        built = region_build_ready(site, published)
        record = {"name": name, "title": region_title(entry), "path": f"regions/{name}/sf-corridor-3d.html",
                  "built": built, "city": entry.get("city"), "description": entry.get("description"),
                  "bbox": entry.get("bbox")}
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
                    copy_if_newer(data, target / data.name)
            # Only the region's data: the app reads it from here (app-regions/<name>/app-model.html
            # points its assets at this folder). The browser map website is retired, so no
            # viewer page is published beside it (vercel.json sends its old addresses to the
            # page that installs the app).
            for stale in ("sf-corridor-3d.html", "index.html"):
                (target / stale).unlink(missing_ok=True)
            facades = site / "facades"
            if facades.is_dir():
                shutil.copytree(facades, target / "facades", dirs_exist_ok=True)
        index.append(record)
    (out / "regions.json").write_text(json.dumps({"regions": index}, indent=1) + "\n")
    built = sum(1 for r in index if r["built"])
    print(f"  regions {built} built of {len(index)} listed -> {out.name}/regions/")
    return index


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
    # The app's own copy of the viewer, cut finer than the site's. The app opens on the model,
    # so this is the first thing it loads; it is a separate file rather than inlined because
    # the viewer fetches its measurements from beside itself either way.
    app_model = BUILD / "app-viewer.html"
    if app_model.exists():
        (out / "app-model.html").write_text(app_model.read_text())
    (out / "index.html").write_text(landing)
    # The landing page's pictures: renders of the model itself, kept as source in tools/landing.
    pictures = ROOT / "tools" / "landing"
    if pictures.is_dir():
        (out / "landing").mkdir(exist_ok=True)
        for picture in sorted(pictures.glob("*.jpg")):
            shutil.copyfile(picture, out / "landing" / picture.name)
    publish_regions(out)

    make_icons.main(out)

    manifest = json.loads((ROOT / "tools/pwa/manifest.json").read_text())
    manifest["id"] = SITE_PATH
    (out / "manifest.webmanifest").write_text(json.dumps(manifest, indent=2) + "\n")

    # The cache name carries a digest of what is being served. Without it a phone that has
    # already installed the app keeps opening the previous build from its own cache, which looks
    # exactly like a deploy that silently did not happen.
    # Everything served, not only the two pages built here. The digest used to cover app.html
    # and the landing page alone, so a deploy that changed nothing but the 3D map's data left
    # the version identical, the old cache alive, and the new payload unreachable on any device
    # that had opened the site before.
    digest = hashlib.blake2b(digest_size=8)
    worker = (ROOT / "tools/pwa/sw.js").read_text()
    digest.update(worker.encode())
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
    sw = worker.replace("__VERSION__", version)
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
    ap.add_argument("--out", type=pathlib.Path, default=None,
                    help="publish into this directory instead of docs/. Set GITHUB_REPO to "
                         "match the repository it will be served from, or every link in the "
                         "manifest and the service worker will point back at the other site.")
    args = ap.parse_args()
    main(args.out)
