# House rendering and filter status — 10 October 2026

This is a counted snapshot, not a completion estimate. The filter scans buildings,
including businesses and apartment blocks, not exclusively residential houses.
Region counts below use the latest completed strict selection for each region.
Private fit counts were captured before reprocessing the new colour policy.

| Region | Buildings indexed | Buildings with candidate views | Private fitted buildings |
| --- | ---: | ---: | ---: |
| SF corridor | 15,986 | 3,794 | 172 |
| Mission | 8,313 | 1,327 | 249 |
| Haight–Castro | 5,293 | 910 | 212 |
| Sunset | 21,697 | 1,699 | 233 |
| Oakland | 3,564 | 484 | 189 |
| Berkeley | 2,669 | 163 | 54 |
| Palo Alto | 1,766 | 783 | 113 |
| San Jose | 4,265 | 136 | 49 |
| Total | 63,553 | 9,296 | 1,271 |

The index contains 100,026 building/view candidates representing 67,069 distinct
observation IDs. These are geometric candidates, not 100,026 downloaded or accepted
photographs. The per-region catalogues contain 666,037 source entries; entries may
overlap across regions, so that sum is not a certified unique-photo count.

Strict metadata screening uses a maximum 35-degree centre/edge angle, predicted
full-front framing, 3–55 m distance, minimum resolved sampling density and the
ten-year date rule with individually matched landmark exceptions. Metadata cannot
prove that two storeys are actually visible or that privacy/identity review passed.

## Pixel screening and reconstruction

The review journal had 5,493 building/view receipts:

- 3,524 pixel-rejected.
- 1,547 passed screening but still need privacy/identity review.
- 352 require pose review.
- 70 download/decode failures, not completed measurements or empty houses.

There were receipts for 3,691 region/building targets, 1,437 targets with a passing
pixel screen, and 4,962 distinct image IDs with pixel-screen records. Receipt counts
are house/view attempts, not independent camera counts or unique raw photographs.

All 1,271 fitted buildings were **low certainty**. The pipeline is producing private
prior-constrained facade specifications, not dense photogrammetric houses. The AI
review queue does not mean that an automatic reviewer has approved those houses.

**New houses rebuilt and published from this pipeline: zero.** Both the committed
and production `sf-corridor-frontage-fits.json` have an empty `buildings` map. No
private fit was promoted to obtain a more impressive completion count.

SF's existing world separately has 8,089 buildings with image-backed opening layouts
and 8,247 material assignments. These are older partial visual enhancements, not
8,089 full photo-reconstructed houses or outputs of the present strict-fit run.

Promotion still needs image-bound full-front/two-storey, entrance/opening, material,
privacy/rights, registration and rendered-accuracy checks. Canonical dimensions are
priors, not independent proof of centimetre accuracy. The workers remain active in
256-view private batches and cannot automatically publish. HP700 and the battery
strictly-above-30% guards remain enabled.

## House colour default

The shared fitting stage now resolves similar floor samples to one dominant wall
colour, weighted by observed wall area. Original samples are retained separately
as `observed_colour`; material labels and height boundaries are not fabricated or
discarded. This is a visual-consistency default, not calibrated albedo measurement.

Independent bands remain when:

- the ground floor is a mapped business/storefront;
- independently labelled materials differ; or
- a colour differs substantially from the dominant sample (CIELAB Delta-E76 > 25).

Unknown floor materials do not constitute evidence of a material change. Upper
levels still share a colour when the business ground floor is exempt. Each sample
is compared with the dominant anchor, preventing a gradual chain of small changes
from merging strongly different end colours. The existing renderer already carries
the resolved height-band colours around the sides and back, while keeping opening
trim separate. No public geometry, triangle count or texture resolution changed.

Regression checks cover similar residential floors, business exceptions, distinct
materials/colours, missing material labels, preservation of original observations,
appearance publication gates, and generated-renderer equality. The worker's source
hash guard invalidated old extraction versions and the supervisor restarted it with
the new implementation.

## Deployment

The previous production release `d05b5e23` is successful and its public renderer
fingerprint matches the current authoritative template. This change affects the
private fitter and future reviewed exports; it requires no manual app rebuild or
forced redeployment. Normal CI-gated Git releases remain in place.
