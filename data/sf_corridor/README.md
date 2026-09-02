# Kerbside SF Corridor Metadata Seed

This catalog covers a bounded San Francisco corridor:

- Marina
- Cow Hollow
- Russian Hill
- North Beach
- Chinatown
- Financial District / Downtown

Bounding box:

- north: `37.8095`
- south: `37.7860`
- west: `-122.4475`
- east: `-122.3920`

The committed external-imagery catalog is metadata only. It does not mirror
KartaView or Panoramax source imagery into Git. Provider pixels are resolved
from source locators on demand, processed under the current pixel budget, and
discarded unless a debug cache is explicitly requested.

Current dense seed:

- Providers: Panoramax + KartaView
- Observations: 1,628
- Eligible observations: 1,619
- Sequences: 19
- H3 coverage cells: 171
- External provider pixels committed: no

Storage expansion now follows `storage/release_shards.json`:

- Tier 0: all normalized provider observations, sequences, coverage, and
  provenance stay in Git as compact Parquet/JSON.
- Tier 1: Kerbside-owned accepted capture JPEGs are grouped by H3 cell and
  target byte size for GitHub Release assets.
- Tier 2: selected full-resolution originals are optional and disabled by
  default.
- Compiled world output remains derived geometry/facts plus provenance pointers,
  not a pile of source photos.

Build/update the storage plan:

```bash
.venv/bin/python scripts/build_storage_manifest.py \
  --catalog data/sf_corridor \
  --out data/sf_corridor/storage/release_shards.json \
  --city-slug sf \
  --city-name "San Francisco" \
  --release-tag sf-current \
  --capture-root data/captures
```

Pack planned release assets for upload:

```bash
.venv/bin/python scripts/pack_release_assets.py \
  --manifest data/sf_corridor/storage/release_shards.json \
  --capture-root data/captures \
  --out-dir build/release_assets/sf-current
```
