#!/usr/bin/env bash
# Rebuild every derived artefact from the harvested provider catalogues, in dependency order.
#
# The harvest itself is not here. It takes tens of minutes and hits two community APIs, so it
# stays a deliberate act: run scripts/harvest_region_observations.py per provider, then this.
set -euo pipefail
cd "$(dirname "$0")/.."

PY=python3
[ -x .venv/bin/python ] && PY=.venv/bin/python

PANORAMAX=${PANORAMAX_CATALOG:-data/sf_corridor_panoramax_dense}
KARTAVIEW=${KARTAVIEW_CATALOG:-data/sf_corridor_kartaview_dense}
MAPILLARY=${MAPILLARY_CATALOG:-data/sf_corridor_mapillary_dense}
CATALOG=${CATALOG:-data/sf_corridor}

for input in "$PANORAMAX" "$KARTAVIEW" "$MAPILLARY"; do
  [ -f "$input/observations/external-000.parquet" ] || {
    echo "missing harvest: $input" >&2
    exit 1
  }
done

echo "== merging provider catalogues"
$PY scripts/merge_sf_corridor_catalogs.py "$PANORAMAX" "$KARTAVIEW" "$MAPILLARY" --out "$CATALOG" > /dev/null

echo "== auditing"
$PY scripts/audit_sf_corridor.py "$CATALOG"

echo "== depth store"
$PY scripts/build_cv_depth_store.py --catalog "$CATALOG" > /dev/null

echo "== release shards"
$PY scripts/build_storage_manifest.py --catalog "$CATALOG" > /dev/null

echo "== 3D corridor map"
$PY scripts/build_sf_corridor_3d.py --catalog "$CATALOG" --reuse-osm

echo "== manifest"
$PY scripts/write_dataset_manifest.py --catalog "$CATALOG" --input "$PANORAMAX" --input "$KARTAVIEW" --input "$MAPILLARY"
