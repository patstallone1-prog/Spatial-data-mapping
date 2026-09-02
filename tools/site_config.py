"""Where the app lives on the internet.

One place, because the address is written into the manifest, the service worker scope, the
install instructions and the app's own copy of its link. A mismatch between any two of those
produces an install that silently opens the wrong page.
"""
from __future__ import annotations

import os

OWNER = os.environ.get("GITHUB_OWNER", "patstallone1-prog")
REPO = os.environ.get("GITHUB_REPO", "Spatial-data-mapping")

#: GitHub Pages serves a project site from the repository name, so the app is never at the root.
SITE_URL = f"https://{OWNER.lower()}.github.io/{REPO}/"
APP_URL = SITE_URL + "app.html"
