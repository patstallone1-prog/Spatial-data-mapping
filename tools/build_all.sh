#!/usr/bin/env bash
# Build every artefact the site serves, in the order they depend on each other.
set -euo pipefail
cd "$(dirname "$0")/.."

PY=python3
[ -x .venv/bin/python ] && PY=.venv/bin/python

[ -f build/map_data.json ] || $PY tools/build_map_data.py
$PY tools/build_app.py
$PY tools/build_site.py
$PY tools/build_landing.py
$PY scripts/publish_visual_pilot.py
# The app's own copy of the viewer, cut finer than the site's (--detail app), from the same
# renderer source: without this the deploy re-copied whichever build/app-viewer.html was made
# by hand last, and the app shipped a viewer older than the site's.
$PY scripts/build_sf_corridor_3d.py --page-only --detail app --out build/app-viewer.html
$PY tools/build_pages.py
# And the app-only regional viewers made from it (docs/app-model.html, docs/app-regions/).
$PY tools/build_app_worlds.py
