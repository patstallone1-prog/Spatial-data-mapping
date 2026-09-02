# Scalable Observation Storage

Kerbside should not become one Git repository full of JPEGs. The durable shape is
one code/core repo, a tiny dataset registry, one city source-data repo per metro,
and a clean compiled-world repo for derived geometry and facts.

## Repository Roles

- `Spatial-data-mapping`: code, tests, schemas, ingestion, CV, and lightweight
  deployable viewers.
- `kerbside-datasets`: tiny registry of cities, versions, hashes, latest
  pointers, and release tags.
- `kerbside-data-sf`: San Francisco source metadata in Git, with bulky owned
  image shards attached to GitHub Releases.
- `kerbside-world`: compiled sidewalks, curbs, meshes, 3D tiles, semantic facts,
  confidence scores, and provenance pointers.

Neighborhood names are labels. H3 cells are the physical shard boundary.

## Preservation Tiers

- Tier 0 stores every discovered observation as metadata only: provider id,
  sequence id, timestamp, GPS, heading, camera metadata, source locator, license,
  attribution, and neighboring frame ids.
- Tier 1 stores every accepted Kerbside-owned mapping frame as a standardized
  downscaled JPEG, packed by H3 cell into GitHub Release assets.
- Tier 2 stores a small selected subset of raw/full-resolution originals. This is
  disabled by default and should be used only when a reconstruction or audit
  proves the extra pixels matter.
- The compiled world stores derived geometry/facts, not source imagery.

## Byte Policy

Release assets are planned around target byte size, not image count. The default
target is 500 MB and the default hard cap is 750 MB, comfortably below GitHub's
2 GiB per-asset release limit. This keeps replacement, download, retry, and
parallel processing units small enough to be pleasant.

The repo ignore rules prevent future `data/captures/*/images/` and
`data/captures/*/raw/` files from being added accidentally. Manifests remain in
Git; pixels move to release assets.

## Current SF Manifest

`data/sf_corridor/storage/release_shards.json` records:

- 171 H3 metadata shards from the merged SF corridor catalog.
- 8 planned Tier 1 release assets for current Kerbside-owned capture JPEGs.
- 108 capture images, about 70 MB total, ready to pack/upload.
- 0 external-provider pixel bytes committed.

Build it with:

```bash
.venv/bin/python scripts/build_storage_manifest.py \
  --catalog data/sf_corridor \
  --out data/sf_corridor/storage/release_shards.json \
  --city-slug sf \
  --city-name "San Francisco" \
  --release-tag sf-current \
  --capture-root data/captures
```

Pack it with:

```bash
.venv/bin/python scripts/pack_release_assets.py \
  --manifest data/sf_corridor/storage/release_shards.json \
  --capture-root data/captures \
  --out-dir build/release_assets/sf-current
```
