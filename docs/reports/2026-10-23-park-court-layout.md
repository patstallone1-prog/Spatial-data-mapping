# Mac park court layout repair — 23 October 2026

## Findings and changes

- The old court complex pass treated closing gaps between OSM pitch outlines as
  evidence of a hard slab. That created dark green bridges and the wrong fence
  route across Moscone's grass corner. Canonical ground files remain intact;
  the Mac viewer now resolves court slabs from the existing SF RPD facilities
  inventory (`ib5c-xgwu`) through `sf-corridor-parks.json.court_layout`.
- Tennis paint centres retain their map positions. The nearest slab axis preserves
  their playing direction even where a two-court slab is wider than it is long.
  Regulation paint fits inside the slab rather than being unnecessarily scaled
  down to a pitch outline. Basketball keeps about three feet of clearance where
  the slab permits it. Actual tennis run-off remains acrylic, not grass; ground
  outside the actual slab uses the surrounding park's normal grass material.
- The extra western tennis pitch beside basketball has no supporting municipal
  tennis slab. The user's site observation is recorded in
  `data/park_courts/reviews.json`; its original OSM paint remains in the source
  ground file and the review record. The Mac visual layout suppresses it.
- Fence routes follow the municipal slab boundaries, not a nearest-sport Voronoi
  divider. Shared edges are deduplicated and runs crossing playing rectangles
  are excluded. Fence existence/height remains inferred, not surveyed truth.
- OSM `man_made=mast,tower:type=lighting` was incorrectly treated as cellular
  equipment. Moscone received 30-metre poles with antennas. Ingestion now keeps
  lighting separate; Mac also handles the older published records correctly,
  draws lighting with a labelled visual fixture prior, and rejects anchors
  inside playing rectangles. Unclassified masts do not become cellular towers.
- Hoop supports now stand behind the baseline instead of inside the playing area.

## Coverage and boundaries

Municipal slab matching improves the SF corridor, Haight/Castro, Mission and
Sunset. Berkeley, Oakland, Palo Alto and San Jose retain existing court layouts
where this SF-only inventory supplies no matching evidence. Classification and
court-equipment safety logic are shared across the Mac regional viewers.

The current build resolves 37 municipal slabs supporting 55 courts across those
four SF regions. Source discrepancies and superseded overlapping slabs remain in
the review records rather than being promoted as new measured facts.

Quest's published entry point and runtime files are unchanged. Attached Quest
windows explicitly retain their previous court layouts, materials and mast
appearance; the new sidecar resolution is Mac-only. Street-tree anchors and
layouts are unchanged. No HP700 data was deleted or its paused worker restarted.

## Verification

Real-data visual checks: Moscone west, Moscone east, and Helen Wills Playground.
Unit checks cover the disputed extra pitch, correct tennis orientation and size,
slab containment, no fence crossing paint, no hard slab on the grass corner,
fallback without municipal evidence, lighting/communications classification,
court-clear lighting anchors, and the independent Quest path.

The previous red page-load CI came from the test drawing stub treating
`Vector3.length()` as a numeric array length when constructing fence rails.
The stub now preserves the vector method; the actual shipped SF and Oakland
modules boot successfully against committed data. Production remains gated on
the required final-head CI checks, not this report.

Source: [SF Recreation & Parks Facilities](https://data.sf.gov/resource/ib5c-xgwu.json)
and [Moscone facility description](https://recpark.sf.gov/Facilities/Facility/Details/Moscone-Rec-Center-101).
The city describes four tennis courts park-wide; the correction does not remove
the separate eastern pair.
