# Regional parity and photographic curb calibration — 15 October 2026

Status: **in progress, not a completed parity/accuracy claim and not deployed**.
Work is isolated on `codex/region-curb-calibration`, based on main `3155f723`.
The active park/ground-cover agent's checkout and uncommitted files were not modified.
Existing default curb shapes, building-height precedence, colours, grass, and road-paint
designs are preserved. The only renderer addition distinguishes municipal physical ramp
points from SF intersection-centre/corner records.

## 1. Regional audit

The repeatable read-only audit is `scripts/audit_region_parity.py`. It compares all seven
published regions outside the main corridor against the same reference criteria. Counts
come from **served payloads**, joined to source artifacts by building ID; successful
ingestion logs and old activation records are not proof of current publication.

Snapshot: `data/benchmarks/region-parity-2026-10-15.json`.

| Region | Sampled building colour | Explicit lidar height source | Measured curb stations | Surveyed facades available |
| --- | ---: | ---: | ---: | ---: |
| Marina/reference | 84.6% | 76.7% | 36.4% | 46.1% |
| Mission | 52.1% | 18.2% | 64.4% | 23.5% |
| Haight–Castro | 28.0% | 10.4% | 48.2% | 27.3% |
| Sunset | 18.8% | 4.4% | 42.5% | 32.7% |
| Oakland | 18.4% | 75.3% | 46.5% | 28.7% |
| Berkeley | 12.2% | 97.8% | 14.9% | 14.8% |
| Palo Alto | 18.5% | 99.4% | 13.5% | 30.0% |
| San Jose | 20.5% | 13.6% | 39.3% | 3.1% |

`M` means **mapped**, not measured; only `S`/`L` enter the measured-curb fraction.
OSM height tags may derive from good sources, but this audit cannot certify their origin.
It does not replace them with lidar merely to improve a percentage. Source coverage is
not visual or independent metric accuracy, and renderer default overrides remain intact.

Notable publication/source gaps:

- Oakland source ground cover has 1,868 yards versus 251 served, and 118 lawns versus
  91 served. No municipal tree records appear in its served ground sidecar.
- Berkeley has no served yard/tree records in that sidecar. This does not count
  nature-atlas vegetation as individually surveyed trees.
- Colour sampling and facade support are much thinner outside Marina; a completed
  prior sampling attempt did not mean every building had a usable photograph.
- San Jose has especially sparse surveyed-facade coverage.
- The reference itself has 1,016 source-colour IDs missing colour in the served payload.
  It is a comparison reference, not an assumed perfect map.

Park/ground sidecars owned by the other agent were audited read-only, not rebuilt from
older local files. Automatic equalization with guessed trees, colours or curb measurements
would inflate coverage without improving truth.

### New Berkeley municipal adapter

The [city's Public Works GIS](https://gis.cityofberkeley.info/arcgis/rest/services/PublicWorks/PubWorks/MapServer)
has useful inventories that the earlier Socrata/general-portal probes missed:

- Layer 13: 721 returned curb-ramp location records.
- Layer 14: 606 crosswalk records, retained as reference evidence. Width units and marking
  domains are not assumed, and these paths do **not** replace current crossing geometry.
- 623 in-bounds ramp points with recognized existing types are staged in the official
  sidecar. Missing (`NONE`), undocumented (`X`), and query-envelope spillover records are
  excluded from rendered ramps, not fabricated into accessible cuts.

`scripts/ingest_berkeley_transport.py` enumerates object IDs and fetches bounded batches,
refusing missing/truncated responses. The regional `official` stage now runs this adapter
for Berkeley only. Discovery records the newly available inventories without promising
surveyed curb lines or sidewalk widths. Every normalized point references a checksummed,
attributed source document. Unknown observation dates and positional accuracy stay unknown;
recorded ramp existence is **not** a verified slope/accessibility measurement.

The viewer used to require SF's corner label for every municipal ramp. Berkeley's points
now have `position_basis=physical_point`: the existing ramp audit can find one within 2 m,
without spreading its existence to other corners within SF's 22 m intersection radius.
No surveyed curb envelope is invented. No live visual sweep of these new points has yet
been completed, so staging is not deployment approval.

## 2. Photo curb reconstruction

The paused `semantic.py` and `photo_kerbs.py` were preserved from the source checkout,
then continued in this isolated branch. Original caches/journals were not overwritten.

`scripts/curbmeasure/diagnose_registration.py` resumes cached evidence without networking:

1. Re-extract all curb points from the usable cached photos, not just old matches inside
   the 4 m scoring cutoff.
2. Compare with finite SF block-curb segments, not infinite extensions or refuge islands.
3. Fit per-photo camera east/north shift and distance scale with robust bounded least
   squares, keeping reference associations fixed.
4. Check the data Jacobian's rank/null space. A single straight curb cannot distinguish
   scale from lateral translation; a parallel pair still cannot locate along-street shift.
5. Keep **oracle/in-sample alignment** separate from independent accuracy. No fitted
   coordinate or height updates canonical facts or default renderer geometry.
6. Audit lidar candidate positions against SF mapped curb lines before treating those
   candidates as a plausible reference for height comparisons.
7. Test local road grade separately, conditioned on the existing lidar terrain grid.

Snapshot: `data/benchmarks/photo-curb-registration-2026-10-15.json`.

Results:

- 30 usable photos reconstructed 8,050 candidate points. This subset is recoverable from
  the old scored cache; the original run reported 88 posed images overall.
- Uncorrected nearest-SF-curb disagreement: median **2.865 m**, P90 **10.50 m**.
  These are diagnostic nearest-reference distances, not certified corresponding-point errors.
- Oracle alignment median falls to **8.55 cm**, but P90 remains **1.15 m** and only **one**
  photo fully identifies all three fitted parameters away from bounds. This is not success.
- That one photo's candidate correction is approximately **2.83 m west, 3.42 m south**, with
  distance scale **1.00185**. Its finite-segment residual MAE remains **47 cm**. It suggests
  substantial position mismatch in that example, not proof of a calibrated camera-height bias.
- Lidar candidates also have a large tail against the reference: even restricting to the
  reference's 5 m interior leaves median **26.6 cm**, P90 **10.04 m**. Candidate identity,
  matching, source freshness and geometry need review before this is ground truth.
- Restricting height comparisons to lidar candidates within 25 cm of SF curb lines leaves
  220 correlated pixel readings from **five photos**, with height MAE **4.74 cm** and P90
  **11.76 cm**. Nearest-point proximity is still not verified object correspondence.
- Terrain-grade ablation on 29 photos barely changes the lateral result: median **2.799 m**
  flat versus **2.792 m** grade-conditioned. Retained point counts differ slightly because
  projection changes the range gate. Road slope is therefore not the dominant explanation
  in this cohort; no claim is made that this is camera-only validation.

### Corrections and safeguards implemented

- One consistent WGS84 local scale for photo projection and validation, replacing mixed
  latitude constants. This is a small metric correction, not a cure for metre-scale error.
- Optional known road-plane grade in curb projection; an analytic test verifies the
  correct height on a hill. Flat ground remains the default until supported grade exists.
- Invalid focal lengths, camera rotations, camera heights and mismatched rasters fail closed.
- Metadata-fetch failures are not cached as permanently measured-empty sequences.
- Future photo runs retain unpaired raw observations and explicitly label the cutoff-conditioned
  scoring denominator; unidentifiable stone-top corrections serialize as JSON null.
- Experimental sidewalk-width projection requires continuous visible sidewalk to a building
  back-edge and a supported curb height. It measures normal to the curb, not oblique-ray length.
  Unknown/occluded back edges yield no width. Legacy cached masks omit buildings, so this
  cohort has **no independently validated photographic sidewalk-width result**.

## What remains before either task can be called complete

1. Resolve the regional publication gaps together with the active park/ground pass; do not
   copy stale generated sidecars over newer work.
2. Increase independent photographic evidence in the light regions; retain measured/inferred
   separation and do not replace mapped heights solely for audit parity.
3. Curate corresponding curb identities and inspect the large lidar-reference tail.
4. Establish camera-height/vertical-datum compatibility or independent camera control; a
   distance-scale fit alone cannot diagnose a unique physical height bias.
5. Freeze calibration on whole training streets/sequences. Evaluate separate untouched
   streets with no reference fitting on the test set. New-street calibrated rollout remains
   withheld because the current pilot does not justify it.
6. Obtain complete masks and independent sidewalk back-edge/width references, then evaluate
   widths rather than substituting road-to-building distance or a procedural width prior.
7. Complete region visual sweeps and the new municipal-point review before promotion/deploy.

The coordinate conventions follow [OpenSfM](https://opensfm.org/docs/geometry.html).
Independent controls belong in alignment/bundle adjustment as described in
[OpenSfM's ground-control documentation](https://opensfm.org/docs/gcp.html); they must not
also be recycled as held-out checkpoints. Robust fitting uses
[SciPy least_squares](https://docs.scipy.org/doc/scipy-1.13.0/reference/generated/scipy.optimize.least_squares.html).

## Reproduction

Install the existing project plus the `curb-photo` extra. `EVIDENCE_ROOT` is the original
checkout containing the cached Mapillary metadata and regional lidar journals. Commands
are run from this checkout; evidence inputs are read-only.

```sh
python scripts/audit_region_parity.py --source-root "$EVIDENCE_ROOT" --out build/audits/region-parity.json
python scripts/curbmeasure/diagnose_registration.py --evidence-root "$EVIDENCE_ROOT" --out build/curbphoto/diagnostics.json
python scripts/ingest_berkeley_transport.py
```

`--publish` on the Berkeley ingestion stages only that official sidecar in `docs`; it does
not build the full app or deploy. Raw municipal snapshots stay under the region's ignored
`official` directory. No licensed photograph pixels are committed by this pass.

## Verification in this pass

137 targeted tests pass, covering regional ingestion, ramp/crossing geometry, the new
Berkeley adapter and source discovery, camera-rank degeneracy, finite curb segments,
invalid calibration inputs, sequence-cache failure recovery, road-grade geometry, and
visible-boundary sidewalk-width safeguards. Ruff passes on the added/resumed modules and
tests. `git diff --check` passes. Graphify's AST map was refreshed; semantic community
labels were not regenerated. These checks do not substitute for the outstanding live
visual sweeps or independent held-out measurement benchmark.
