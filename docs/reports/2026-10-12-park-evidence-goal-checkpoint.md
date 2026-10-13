# Park evidence goal — active implementation checkpoint

This is not a completion report. The goal remains park enrichment and rendering,
hybrid path materials, Francisco/HABS release verification, and rigorous electrical
connectivity using the requested sources. Final promotion remains conditional on
render, provenance, privacy, source-rights, continuity and regression checks.

## Previous pass closed

PR #57 merged as `27c126185320ef98218ddc1ecd16389f7b489319` and production succeeded.
CI: 1,459 passed, 2 skipped; lint and the road baseline passed. The published renderer
hash is `5e6acab7e7965a6d9344cd82ff66bc76f1d24086190b0cb79c5380cb55c414ef`.
The live Moscone page was inspected at close range after its slow full-region load:
no invented court wiring, retained light poles, and no broad repeated grass stains.
Full-region startup remains a performance concern; this pass must not amplify it.

## Source and release evidence

- RPD Properties `gtr9-ntp6`: 253 SF-bounded property rows.
- RPD Facilities `ib5c-xgwu`: 2,457 physical/area rows, including 67 restroom rows,
  119 maintenance-building rows and 176 cargo-container rows.
- RPD Functional Areas `38b7-6db3`: 7,171 rows.
- All three source metadata records advertise PDDL. The compressed snapshots and
  canonical manifest retain source hashes, dates, polygon parts and raw attributes.
  Logical IDs are property-scoped because the real source reuses some facility IDs.
  Mixed roles and orphaned identities are recorded, not silently reconciled.
- The current PG&E service is
  `https://services2.arcgis.com/mJaJSax0KPHoCNB6/ArcGIS/rest/services/DRPComplianceRelProd/FeatureServer/3`.
  Its metadata confirms `LineDetail`, polylines, FeederId, CSV_LineSection,
  voltage_kv and phase_cnt. There is no overhead/underground field. The old endpoint
  in the user guide returned Invalid URL; do not hard-code it into ingestion.
- PG&E's portal claims ownership of derivatives and restricts use to its intended
  distribution-planning purposes. Public Kerbside derivative rights are unverified;
  permission was requested. Do not treat a public endpoint or blank copyright field
  as permission to redistribute GRIP-derived map assets.
- Production's frontage manifest and
  `fits/sf-corridor/-12244_3780-95b51a5d062e.json` match committed bytes. That tile
  includes IDs 263276306, 263276308 and 263276313: the Francisco contributions.
- Production's `validation/habs-2026-10-12.json` also matches committed bytes.
  It explicitly says 12 houses in the reference pack, 3 scored, 4 panels scored.
  It is a validation artifact, not twelve geolocated city-world reconstructions.

## Implemented, not yet viewer-integrated

- `smc.parks.surfaces`: explicit taxonomy, evidence precedence and confidence caps,
  reviewed-image gating, independent-sequence checks, proposed-project rejection,
  retained conflicts, weak landscape hypotheses, and material-transition splitting
  that retains canonical bends and interpolated elevations.
- `smc.parks.inventory`: property/facility/functional-area identities, source parts,
  role conflict records, independent geometry/semantic/material/access claims.
- `scripts/ingest_sf_parks.py`: reproducible current-source download, PDDL check,
  compressed immutable snapshots, canonical artifact and manifest. This snapshot is
  source evidence only. It is not a claim that 8,000-plus park objects now render.
- City downloads use the maintained certifi root bundle, with TLS verification kept
  enabled. The macOS Python system bundle failed the city host's certificate chain.
- Focused foundation/official-record checks: 68 passed; blocking lint passed.

## Remaining required work

1. Join inventory parts to existing canonical park/building/path identities without
   replacing stronger geometry. Resolve meaningful identity/role conflicts.
2. Add physical park-object render families: public restrooms and maintenance sheds
   must not inherit residential windows, room layouts or house-entry behavior.
   Extend recreation, seating, water, fencing/lighting and access semantics where
   inventory or current facility pages supply evidence, not random decoration.
3. Wire explicit OSM surface tags, current official specifications and reviewed
   imagery into the actual pedestrian-way pipeline. Join landscape context safely;
   sand near a beach is a hypothesis, not an assumption about Presidio Wall.
   Build/verify material-specific path rendering and transition continuity.
4. Add curated, dated facility-page and completed-project evidence; retain proposed
   project records without turning them into current physical geometry.
5. Build the LineDetail connector, empirical pole-offset calibration, along-route
   adjacency, ambiguity/branch rejection, underground vetoes, reviewed image-span
   confirmation, electrical/telecom/unknown classification and phase-informed
   rendering. Logical connectivity stays separate from visual catenaries. Unknown
   overhead status never renders. GRIP-derived publication remains rights-gated.
6. Run fixed/representative park visual audits (including Moscone and Presidio Wall),
   cross-region path tests, performance checks, all consumer version checks and
   release gates before final deployment. Retain canonical/procedural fallbacks for
   evidence that fails promotion; do not invent geometry to satisfy a gate.

Sources: [RPD Facilities](https://data.sf.gov/api/views/ib5c-xgwu.json),
[RPD Functional Areas](https://data.sf.gov/api/views/38b7-6db3.json),
[PG&E current service](https://services2.arcgis.com/mJaJSax0KPHoCNB6/ArcGIS/rest/services/DRPComplianceRelProd/FeatureServer),
[PG&E disclaimer](https://grip.pge.com/).
