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
$PY tools/build_pages.py
