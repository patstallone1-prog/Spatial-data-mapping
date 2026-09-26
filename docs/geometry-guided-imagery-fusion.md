# Geometry-guided imagery fusion pilot

## Stage 1: source provenance and pixel storage

`src/smc/reconstruction/provenance.py` defines strict, versioned JSON contracts
for a `SourceAsset`, an `AcquisitionManifest`, and a `FlightManifest` (`flight.json`).
The acquisition and flight retain the **full ordered frame list**; overlap edges
describe stereo relationships but never filter frames. Every asset records its
dataset/acquisition, capture epoch, WGS84 footprint, GSD, source CRS and vertical
datum, optional camera calibration, raw SHA-256/length, and one or more aliases
with independent license, attribution, and allowed uses. A pixel hash is filled
only after decoding. Export a machine-readable schema with:

```sh
python scripts/register_reconstruction_source.py schema asset
python scripts/register_reconstruction_source.py schema acquisition
python scripts/register_reconstruction_source.py schema flight
```

Register a complete flight/sequence from metadata, then its images one by one:

```sh
python scripts/register_reconstruction_source.py flight \
  --acquisition acquisition.json --flight flight.json \
  --assets frame-001.json frame-002.json --catalog-root build/source-catalog
python scripts/register_reconstruction_source.py image \
  --asset frame-001.json --image frame-001.tif \
  --catalog-root build/source-catalog --gcs gs://PRIVATE_BUCKET/reconstruction
```

Omit `--gcs` for a local test store; use the existing `gcs` optional dependency
and application-default credentials for cloud blobs. Register lidar/DEM/GIS
metadata with the `asset` command and its `--file` checksum check. Acquisition,
flight, and asset JSON records are create-only. A small SQLite index retains
every source alias and its own rights, while losslessly compressed pixels are
addressed by a SHA-256 of a canonical header plus decoded samples. The header
includes oriented width/height, channel count, bit depth, and normalized colour
space. EXIF orientation is applied and embedded ICC profiles are converted to
sRGB. Identical decoded pixels share one object even if file encodings differ;
nearly identical views never merge. GCS writes use create-only generation
preconditions, so parallel workers cannot overwrite a pixel object.

This stage does **not** fetch any external source or assert that its license is
approved. Original source bytes remain locatable by raw checksum. Pillow-backed
registration supports 8-bit RGB/gray and 16-bit grayscale; high-bit-depth
multichannel TIFF is rejected rather than silently reduced to 8 bits and needs
a lossless GDAL/libvips adapter in the connector stage. Large flights should be
decoded on cloud workers with temporary scratch, not on the laptop. The SQLite
catalog is metadata-sized but must be backed up or migrated to a cloud database
before multi-host production ingestion.

The physical map in `sf-corridor-3d.json` remains canonical. Visual cells are
render-only and carry its SHA-256; a mismatch blocks publication. The pilot is
the four adjacent cells `c13r03`, `c13r04`, `c14r03`, and `c14r04`.

## Current implementation state

`scripts/build_surface_fusion.py` prepares blocked cell manifests, schema-correct
surface tables, and provisional massing-only LOD0 GLBs. Preparation is opt-in
as the journalled `reconstruct` region-ingestion stage. It does not move curbs,
footprints, roofs, or collision. The held-out benchmark has 300 metadata-only
references separated by capture date and sequence; image-byte hashes and
independent geometry/material/privacy truth have not been acquired.

The optional reconstruction runner checks rights and held-out leakage before
using ALIKED/LightGlue through hloc and COLMAP/PyCOLMAP. It has not been run
on licensed oblique imagery here. It requires those pinned external tools,
calibrated imagery, reviewed masks, surveyed control, and a verified vertical
datum. A monocular depth model cannot supply sole geometry truth.

The intermediate rectified-surface path is:

```sh
python scripts/fuse_rectified_surfaces.py local-surfaces.json --out build/visual/rectified
```

`local-surfaces.json` has `schema_version: 1`, `cell_id`, `run_id`, and a
`surfaces` array. Each surface names `canonical_feature_id`,
`canonical_face_id`, `semantic_class`, `pixels_per_m`, optional `material`, and
`views`. Each view must have an observation UID, registered source/license IDs,
capture timestamp with timezone, sequence ID, RGB image path and SHA-256,
binary visibility-mask path and SHA-256, `privacy_reviewed: true`, weight, and
native pixels per metre. Images must already be rectified to the same canonical
face. The visibility mask excludes privacy-sensitive and temporary objects.
The pilot benchmark's held-out UIDs are rejected. This path produces PNG
atlases, packed per-texel observation bitmaps and coverage classes in NPZ,
source-index attribution JSON, and `surface-metadata.parquet`. These are
**intermediate evidence**, not KTX2, GLB, or production assets.

## Promotion

```sh
python scripts/validate_visual_pilot.py --require-promotion
python scripts/publish_visual_pilot.py --publish
```

Promotion needs verified imagery rights, all LODs, KTX2/meshopt extensions,
complete per-texel provenance, checked vertical datum, independent benchmark
truth, privacy review, and measured quality/performance results. It currently
fails by design. `scripts/publish_visual_pilot.py` permits canonical-only
builds, but rejects an incomplete visual pilot under `docs/visual/pilot`.
`tools/build_all.sh` and CI run this check. The published viewer remains on the
canonical/procedural world until a complete visual-tile consumer is integrated
behind a feature flag and the gates pass. Google imagery and Google
Photorealistic 3D Tiles are excluded.
