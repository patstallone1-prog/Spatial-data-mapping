"""The live site follows the release: a pull request with the small files, the data on R2.

The viewer finds every data file through ``/asset-map.json`` (``viaStore`` in the renderer) and
lists its areas from ``app-regions.json``; a new cell needs an entry there and its app page
(``tools/build_app_worlds.py``). So promotion is:

1. write ``docs/asset-map.json`` from the live release (its version, base and file map);
2. list each newly published cell in ``docs/regions.json`` (built, with its bounds);
3. lay the cell's files out under ``docs/regions/<cell>/`` -- for the page build only -- and run
   the documented rebuild (``build_sf_corridor_3d.py --page-only --detail app`` then
   ``tools/build_app_worlds.py``);
4. with ``--interiors``, publish the interior engine's collected batches and restaurant rounds
   (:func:`promote_interiors`) before the rebuild;
5. commit only the small files (the map, the indexes, the pages and their release record), never
   the cell's data, which the map sends to R2; push a branch and open a pull request with
   auto-merge. CI's three gates (ruff, pytest, the render audit) and Vercel's deploy gate
   (``tools/vercel/gate.mjs``) decide, exactly as for any other change.

After the deploy, :func:`check_live` reads the live ``asset-map.json`` and asks for its chunks; if
the release it names does not answer, the controller rolls the R2 pointer back and opens the
pull request that restores the previous map.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .checkpoint import get_pointer, pull_tree
from .publish import Publisher
from .store import ObjectStore

#: The regions the interior engine furnishes (scripts/run_interior_engine.py REGIONS).
INTERIOR_REGIONS = ("sf-corridor", "berkeley-downtown", "oakland-downtown", "palo-alto-downtown",
                    "san-jose-downtown", "sf-haight-castro", "sf-mission", "sf-sunset")

SMALL_SUFFIXES = {".html", ".json", ".webmanifest", ".js", ".mjs"}


#: Where the page asks for the bucket's files: under the site's own address, which Vercel
#: proxies to the bucket's CloudFront (vercel.json ``rewrites``). Asked for on the bucket's own
#: address the browser needs CloudFront's CORS headers, and CloudFront sends none when the
#: request carries a header its policy does not list -- Chrome's ``priority`` -- which broke the
#: site on 2026-10-27 (#117). Same-origin requests need no CORS at all.
STORE_PATH = "/store"
#: The pages that have that proxy: the site's. A local server or a preview reads its own copies
#: (``viaStore`` in the renderer skips a map that does not list its origin).
SITE_ORIGINS = ["https://spatial-data-mapping.vercel.app"]


def asset_map(release: dict, previous: dict | None = None) -> dict:
    """The release's files over the site's present map: what the site offloaded itself
    (tools/publish_chunks.py -- its pages' data, interiors, paths) stays mapped beside the
    cells, so a promotion never quietly sends those back to the site. Only a map on the same
    bucket is kept: an asset map has one. ``base`` is the site's proxy path; ``origin`` the
    bucket it proxies."""
    kept = previous and previous.get("origin", previous.get("base")) == release["base"]
    files = dict(previous["files"]) if kept else {}
    files.update(release["files"])
    return {"schema": "kerbside.asset_map/1", "version": release["version"], "base": STORE_PATH,
            "origin": release["base"], "origins": SITE_ORIGINS, "files": dict(sorted(files.items()))}


def update_regions(index: dict, release: dict, registry: dict) -> list[str]:
    """Add each published cell to the region index; returns the names added."""
    known = {r["name"] for r in index["regions"]}
    meta = {r["name"]: r for r in registry.get("regions", [])}
    added = []
    for cell in sorted(release.get("cells", {})):
        if cell in known:
            continue
        info = meta.get(cell, {})
        index["regions"].append({
            "name": cell, "title": info.get("title") or cell.replace("-", " "),
            "path": f"regions/{cell}/sf-corridor-3d.html", "built": True,
            "city": info.get("city"), "description": info.get("description", ""),
            "bbox": info.get("bbox"), "published_via": "cloud release",
            "release": release["version"]})
        added.append(cell)
    return added


MATERIALISE_THREADS = 16


def materialise(publisher: Publisher, release: dict, repo: Path, cells: list[str]) -> None:
    """The cells' files under docs/regions/<cell>/, from the public chunks, for the page build.
    Fetched sixteen at a time: one by one, a release of small chunks came down at 4 MB a minute."""
    wanted = []
    for site_path, chunk in release["files"].items():
        parts = site_path.split("/")
        if len(parts) >= 3 and parts[0] == "regions" and parts[1] in cells:
            target = repo / "docs" / site_path
            if not target.exists():
                wanted.append((chunk, target))
    with ThreadPoolExecutor(max_workers=MATERIALISE_THREADS) as pool:
        for _ in pool.map(lambda job: publisher.store.get_file(*job), wanted):
            pass


def commit_paths(repo: Path, cells: list[str]) -> list[str]:
    """The changed files to commit: small files only, and none of a cell's data."""
    out = subprocess.run(["git", "status", "--porcelain", "-uall", "docs"], cwd=repo,
                         capture_output=True, text=True, check=True).stdout
    paths = []
    for line in out.splitlines():
        path = line[3:].strip().strip('"')
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        parts = path.split("/")
        if len(parts) >= 3 and parts[0] == "docs" and parts[1] == "regions" and parts[2] in cells:
            continue  # the cell's data: served from R2 through the asset map
        if Path(path).suffix in SMALL_SUFFIXES or path.endswith("app-landwater.bin"):
            paths.append(path)
    return sorted(paths)


def promote_interiors(repo: Path, private: ObjectStore) -> dict:
    """The collected interiors onto the site: each region's batches (``pointers/interiors-
    <region>.json``) restored under build/inferred-interiors and published by the runner's own
    ``--publish`` (a house only if its validation passed); the restaurants' latest rounds
    (``pointers/restaurants-latest.json``) copied over docs/inferred-restaurants."""
    from .stages import RESTAURANT_STATE

    regions = []
    for region in INTERIOR_REGIONS:
        pointer = get_pointer(private, f"interiors-{region}")
        if pointer:
            # Not cleaned: batches this checkout ran itself stay, and are published with them.
            pull_tree(private, pointer["tree"], repo, clean=False)
            regions.append(region)
    if regions:
        subprocess.run([sys.executable, "scripts/run_interior_engine.py", "--publish"], cwd=repo, check=True)
    restaurants = get_pointer(private, "restaurants-latest")
    if restaurants:
        pull_tree(private, restaurants["tree"], repo, clean=False)
        shutil.copytree(repo / RESTAURANT_STATE, repo / "docs/inferred-restaurants", dirs_exist_ok=True)
    return {"interior_regions": regions, "restaurants": bool(restaurants)}


def promote(repo: Path, publisher: Publisher | None, *, rebuild: bool = True,
            interiors: ObjectStore | None = None) -> dict:
    repo = Path(repo)
    release = publisher.current() if publisher else None
    if not release and interiors is None:
        return {"changed": False, "reason": "nothing released"}
    added: list[str] = []
    if release:
        map_path = repo / "docs/asset-map.json"
        previous = json.loads(map_path.read_text()) if map_path.exists() else None
        map_path.write_text(json.dumps(asset_map(release, previous), indent=1) + "\n")
        index_path = repo / "docs/regions.json"
        index = json.loads(index_path.read_text())
        registry = json.loads((repo / "data/regions/regions.json").read_text())
        added = update_regions(index, release, registry)
        index_path.write_text(json.dumps(index, indent=1) + "\n")
        if added:
            materialise(publisher, release, repo, added)
    furnished = promote_interiors(repo, interiors) if interiors is not None else None
    if rebuild:
        for cmd in ([sys.executable, "scripts/build_sf_corridor_3d.py", "--page-only", "--detail", "app",
                     "--out", "build/app-viewer.html"], [sys.executable, "tools/build_app_worlds.py"]):
            subprocess.run(cmd, cwd=repo, check=True)
    version = release["version"] if release else time.strftime("interiors-%Y%m%d-%H%M%S", time.gmtime())
    return {"changed": True, "version": version, "added": added, "interiors": furnished,
            "paths": commit_paths(repo, added)}


def _github(method: str, url: str, token: str, body: dict) -> dict:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method=method, headers={
        "Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
        "User-Agent": "kerbside-cloud-publisher"})
    with urllib.request.urlopen(req, timeout=60) as response:
        return json.loads(response.read() or b"{}")


def open_pull_request(repo: Path, paths: list[str], *, version: str, slug: str, token: str,
                      base: str = "main", author: tuple[str, str] = ("Kerbside Cloud Publisher",
                                                                     "cloud-publisher@users.noreply.github.com"),
                      github=_github) -> dict:
    """Commit ``paths`` on a release branch, push it, open a PR and ask for auto-merge."""
    branch = f"cloud-release/{version}"
    git = lambda *a: subprocess.run(["git", *a], cwd=repo, check=True, capture_output=True, text=True)  # noqa: E731
    git("checkout", "-B", branch)
    git("add", "--", *paths)
    git("-c", f"user.name={author[0]}", "-c", f"user.email={author[1]}", "commit", "-m",
        f"Cloud release {version}\n\nPublished cells and their asset map, from the controller's "
        "release pointer. Data is served from R2; this commit carries only the small files.")
    git("push", f"https://x-access-token:{token}@github.com/{slug}.git", f"HEAD:refs/heads/{branch}",
        "--force-with-lease")
    pr = github("POST", f"https://api.github.com/repos/{slug}/pulls", token, {
        "title": f"Cloud release {version}", "head": branch, "base": base,
        "body": "Automated by the Kerbside controller (smc.cloud.site). Merges when CI passes."})
    github("POST", "https://api.github.com/graphql", token, {
        "query": "mutation($id:ID!){enablePullRequestAutoMerge(input:{pullRequestId:$id,"
                 "mergeMethod:MERGE}){clientMutationId}}", "variables": {"id": pr["node_id"]}})
    return {"pr": pr.get("html_url"), "number": pr.get("number"), "branch": branch}


def check_live(site: str, expected: str, publisher: Publisher, sample: int = 20) -> dict:
    """Whether the live site serves release ``expected`` and its chunks answer."""
    try:
        with urllib.request.urlopen(f"{site.rstrip('/')}/asset-map.json", timeout=30) as r:
            live = json.loads(r.read())
    except (OSError, ValueError) as exc:
        return {"ok": False, "why": f"asset map unreadable: {exc}"}
    if live.get("version") != expected:
        return {"ok": False, "why": f"live map is {live.get('version')}, not {expected}", "pending": True}
    names = sorted(set(live["files"].values()))[:sample]
    missing = [n for n in names if not publisher.answers(f"{publisher.base}/{n}")]
    return {"ok": not missing, "why": f"{len(missing)} chunks do not answer" if missing else "live"}
