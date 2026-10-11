# Private 3D Street View reference acquisition

The user explicitly accepted non-commercial use and asked to defer SF-XL. SF-XL remains disabled; no access request was submitted. The remaining 78 unnamed retail/restaurant buildings are not pursued in this pass.

## Acquisition and storage

The [official 3D Street View repository](https://github.com/amir32002/3D_Street_View) supplies a georegistered **manually generated** SF model and separate image/evaluation bundles. These are not a dense photogrammetric mesh or independent surveyed curb truth. The [dataset terms](https://github.com/amir32002/3D_Street_View/blob/master/LICENSE) restrict source redistribution and commercial derivatives. Consent enables private research only, not public distribution of the supplied mesh, images or detailed copies of them.

The verified SF OBJ is on HP700 at:

`/Volumes/HP P700 1/Kerbside/frontage-run-2026-10-10/private-datasets/3d-street-view/`

It contains **12,486,091 bytes, 164,144 vertices and 232,451 polygon faces**. Its receipt records the local SHA-256, source URL and license; the provider does not publish an independent file checksum. Capture epoch and vertical datum stay unknown. EPSG:3857 is a coordinate hypothesis, not a survey certification.

Discovery probed the first camera/target record in all 54 published unaligned training regions using bounded range reads. None of those sampled rectangular regions was in SF. The official mixed-city evaluation acquisitions are retained intact instead of pretending unrelated cities supply SF coverage:

- `test_matching.tar`: 1,034,936,320 bytes.
- `test_poseregression.tar`: 314,286,080 bytes.

The host incorrectly reports zero `Content-Length` on HEAD; the reader now verifies a single-byte 206 range to obtain the real length. The training files named `.tar` are actually gzip-compressed, whereas the evaluation TARs are uncompressed. These cases are detected from data rather than filename.

Transfers use four verified byte ranges with bounded prefetch memory, a contiguous-prefix checkpoint and local chunk hashes. Uncommitted tails are discarded on resume, complete files receive a SHA-256 receipt, and empty/truncated files cannot masquerade as successful evidence. Disk space and the external volume UUID are checked; a 4 GiB reserve is retained. Indexed gzip support is pinned to `indexed_gzip==1.10.3` and installed on HP700, not into another agent's environment. Its [documented seek index](https://github.com/pauldmccarthy/indexed_gzip) permits lazy image access without repeatedly decompressing a huge archive.

## Actual dataset interfaces

The real pose format provides image A/B, relative heading/pitch/roll in degrees and relative longitudinal/lateral/height translation in metres. Matching records provide image A/B, a same-target label and relative heading/pitch; the source explicitly declares those angles invalid for negative pairs. Negative pairs therefore cannot supply orientation or a positive overlap edge.

The full-context `_i` images inspected are **640 × 640**. Their `_p` crops are **101 × 101**, not adequate replacements for full fronts. Both variants remain in the original acquisition; the private benchmark adapter uses full-context pixels and preserves all pair labels, including negatives.

SQLite stores image locators, offsets, variants, original label text, typed relative poses and matching records. Lazy reconstruction/benchmark adapters retain source aliases and one canonical oriented/colour-normalized decoded-pixel blob per exact hash. Identical images are not promoted into additional independent cameras. Original archives are not spatially thinned or scattered into an unrelated loose-JPEG collection.

Absolute geolocation, capture times, calibration and independent panorama identities remain unresolved in the evaluation bundle. Relative pose is not a street address. These records cannot silently pass the current ten-year/full-front frontage rules or be assigned to a real house without registration and review. A 2016 publication is not evidence that an image is current.

## Reference review, not accuracy certification

A real private massing audit spatially compared source vertices with the canonical SF footprints and produced review entries for **2,285 buildings across 54 diagnostic 250 m cells**. It preserves canonical/source hashes and writes nothing into canonical geometry. Differences in vertex-height span are review signals only: object correspondence, source age, coordinate system and datum are not independently validated. This is not a committed lidar MAE benchmark or a completed photographic 3D block-by-block visual sweep.

The source-rights registry allows private CV/reference/pose-benchmark use but cannot satisfy persistent public hosting, redistribution, commercial use or the public mesh promotion requirements. The public app receives tested pipeline code and renderer fixes; restricted source bytes and detailed reference assets remain on HP700.

The existing power-aware supervisor can resume the consented reference acquisition alongside the frontage filter/matcher. It retains the same verified-drive, disk-reserve and battery >30% guards, never automatically publishes, and prevents duplicate download processes with an acquisition lock.

## Verification and limits

Focused tests cover zero-length HEAD recovery, bounded ranges, gzip/plain-TAR handling, missing partner rollback, exact-pixel alias deduplication, preserved relative units, invalid-negative orientation, no fabricated geolocation/intrinsics, resumable contiguous-prefix transfers and public-rights refusal. Production is CI gated. The earlier renderer/name PR #34 passed all required checks and deployed as `8405cceb`; two initially failing contract tests were corrected without bypassing the gate.

Remaining research work: independently georegister/calibrate evaluation imagery; perform privacy review; assess current-versus-historical coverage; run actual SfM/dense reconstruction and lidar comparisons; visually review source/render blocks; and obtain any additional public derivative rights before promoting detailed source-derived assets. Download and import statuses in the private working set, not this static report, are authoritative for whether each large acquisition has finished.
