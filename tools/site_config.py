"""Where the app lives on the internet.

One place, because the address is written into the manifest, the service worker scope, the
install instructions and the app's own copy of its link. A mismatch between any two of those
produces an install that silently opens the wrong page.

The site is served by Vercel from ``docs/`` (vercel.json at the repository root), at the root
of its domain. It used to be a GitHub Pages project site, which lives under the repository's
name (``/Spatial-data-mapping/``); everything built here is relative, so the pages work under
either, and only the absolute address printed and shown to people depends on this file.
Override it with KERBSIDE_SITE_URL once the project has a custom domain.
"""
from __future__ import annotations

import os

OWNER = os.environ.get("GITHUB_OWNER", "patstallone1-prog")
REPO = os.environ.get("GITHUB_REPO", "Spatial-data-mapping")

SITE_URL = os.environ.get("KERBSIDE_SITE_URL", "https://spatial-data-mapping.vercel.app/")
if not SITE_URL.endswith("/"):
    SITE_URL += "/"
#: The path the site is served under: "/" on Vercel, "/<repo>/" on a GitHub Pages project site.
SITE_PATH = "/" + SITE_URL.split("://", 1)[-1].split("/", 1)[-1]
APP_URL = SITE_URL + "app.html"
