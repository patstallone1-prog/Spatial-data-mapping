"""The live site follows the release: a pull request with the small files, the data on R2.

The viewer finds every data file through ``/asset-map.json`` (``viaStore`` in the renderer) and
lists its areas from ``app-regions.json``; a new cell needs an entry there and its app page
(``tools/build_app_worlds.py``). So promotion is:

1. write ``docs/asset-map.json`` from the live release (its version, base and file map);
2. list each newly published cell in ``docs/regions.json`` (built, with its bounds);
3. lay the cell's files out under ``docs/regions/<cell>/`` -- for the page build only -- and run
   the documented rebuild (``build_sf_corridor_3d.py --page-only --detail app`` then
   ``tools/build_app_worlds.py``);
4. commit only the small files (the map, the indexes, the pages and their release record), never
   the cell's data, which the map sends to R2; push a branch and open a pull request with
   auto-merge. CI's three gates (ruff, pytest, the render audit) and Vercel's deploy gate
   (``tools/vercel/gate.mjs``) decide, exactly as for any other change.

After the deploy, :func:`check_live` reads the live ``asset-map.json`` and asks for its chunks; if
the release it names does not answer, the controller rolls the R2 pointer back and opens the
pull request that restores the previous map.
"""

from __future__ import annotations

import json
import subprocess
import sys
import urllib.request
from pathlib import Path

from .publish import Publisher

SMALL_SUFFIXES = {".html", ".json", ".webmanifest", ".js", ".mjs"}


def asset_map(release: dict) -> dict:
    return {"schema": "kerbside.asset_map/1", "version": release["version"], "base": release["base"],
            "files": dict(sorted(release["files"].items()))}


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


def materialise(publisher: Publisher, release: dict, repo: Path, cells: list[str]) -> None:
    """The cells' files under docs/regions/<cell>/, from the public chunks, for the page build."""
    for site_path, chunk in release["files"].items():
        parts = site_path.split("/")
        if len(parts) >= 3 and parts[0] == "regions" and parts[1] in cells:
            target = repo / "docs" / site_path
            if not target.exists():
                publisher.store.get_file(chunk, target)


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


def promote(repo: Path, publisher: Publisher, *, rebuild: bool = True) -> dict:
    repo = Path(repo)
    release = publisher.current()
    if not release:
        return {"changed": False, "reason": "nothing released"}
    (repo / "docs/asset-map.json").write_text(json.dumps(asset_map(release), indent=1) + "\n")
    index_path = repo / "docs/regions.json"
    index = json.loads(index_path.read_text())
    registry = json.loads((repo / "data/regions/regions.json").read_text())
    added = update_regions(index, release, registry)
    index_path.write_text(json.dumps(index, indent=1) + "\n")
    if added:
        materialise(publisher, release, repo, added)
    if rebuild:
        for cmd in ([sys.executable, "scripts/build_sf_corridor_3d.py", "--page-only", "--detail", "app",
                     "--out", "build/app-viewer.html"], [sys.executable, "tools/build_app_worlds.py"]):
            subprocess.run(cmd, cwd=repo, check=True)
    return {"changed": True, "version": release["version"], "added": added,
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
