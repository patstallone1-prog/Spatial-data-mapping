"""Session setup shared by the test suite.

The app pages (docs/app-model.html, docs/app-regions/*/app-model.html), the release manifest and
the service worker are generated from the renderer's source and are not in the repository
(smc.renderer.pages). Tests that read them get them written here first -- once, by the
controlling process before any xdist worker starts -- when they are missing or were written
from another revision of the renderer.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"


def _pages_current() -> bool:
    from smc.renderer.pages import app_template

    release = DOCS / "runtime-release.json"
    if not (release.is_file() and (DOCS / "app-model.html").is_file() and (DOCS / "sw.js").is_file()):
        return False
    import hashlib

    try:
        manifest = json.loads(release.read_text(encoding="utf-8"))
    except ValueError:
        return False
    if manifest.get("renderer_sha256") != hashlib.sha256(app_template().encode()).hexdigest():
        return False
    # The release also records the runtime assets the pages load (docs/city/*, the vendored
    # codec, ...): one edited since the pages were written makes the release stale, and every
    # checksum test against it fails, though the renderer itself has not changed.
    for name, digest in manifest.get("runtime_assets_sha256", {}).items():
        path = DOCS / name
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            return False
    return True


def pytest_configure(config) -> None:
    if hasattr(config, "workerinput"):  # an xdist worker: the controller has done it
        return
    if not (DOCS / "app-regions.json").is_file():
        return  # a sparse checkout without the site
    if not _pages_current():
        from smc.renderer.pages import write_app_pages

        write_app_pages(DOCS)
