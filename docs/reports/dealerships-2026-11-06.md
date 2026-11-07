# Dealerships, chain identities and staged assets — 2026-11-06

The new parcel-aware dealership format passed ten fixed synthetic shape cases. It keeps
source parcel/building boundaries, supplied driveway centerlines and observed openings.
Unobserved parking, furniture and facade details are labeled inferred. It rejects missing
parcel/road access rather than inventing a parking lot from a building bounding rectangle.

| Fixed shape case | Exterior spaces fitted | Showroom displays fitted |
| --- | ---: | ---: |
| Toyota Wide | 46 | 6 |
| Honda Trapezoid | 44 | 6 |
| Ford L Lot | 55 | 6 |
| Nissan Courtyard | 34 | 6 |
| Mazda Compact | 6 | 0 |
| Bmw Angled | 58 | 6 |
| Kia Deep | 40 | 6 |
| Lexus Notched Shell | 45 | 6 |
| Mercedes Irregular | 47 | 6 |
| Independent Tiny | 3 | 0 |

Compact showrooms may have no display car when entry clearance cannot be retained. Counts
come from the planner's checked output, not a claim about an actual dealership's capacity.
All cases retained clear connected vehicle routes and pedestrian entrance approaches.

The chain library now has 61 identities: 24 additions in this pass, with 18 additional
publisher-supplied artwork assets and recorded source URLs/checksums. Research observations,
color approximations and unknown location/remodel generations remain explicit. The separate
review bundle contains 32 storefront examples (24 new identities plus eight existing cases).
Sign placement defaults to the entrance span, and marque/local dealership names stay separate.

## Verification

- Changed-module selector: 60 Python test files, one Node test file, no uncovered paths,
  no syntax errors, no full-repository audit.
- Selected Python checks: **655 passed, 9 skipped**, 101.03 seconds.
- Selected Node checks: **16 passed**. Selected lint passed.
- Actual browser: all ten dealership cases and all 32 storefront cases selected and rendered;
  no warning/error console messages. Toyota entrance and Walmart wordmark also inspected
  visually. Camera/roof/car controls, resize behavior and finite real Three.js geometry are
  covered by the targeted checks.
- After artwork review: 70 targeted exterior checks passed. Honda displays only its
  wordmark; the dealership preview fetches fresh asset metadata when reloaded.
- Review bundle rebuild: 10/10 dealerships and 32/32 storefronts passed, no rejected cases.
- Source artwork bytes remain intact. The Kia publisher SVG uses CRLF; whitespace checking
  permits CR-at-EOL rather than rewriting the archived source and invalidating its checksum.
- Local review: `http://127.0.0.1:8797/dealerships.html`. No deployment or production export.

## Asset acquisition status

Eight Kenney CC0 NPC/vehicle packs were downloaded to HP and verified on November 5,
including original ZIPs, licenses, receipts and a resumable catalogue: 1,101 model files
across formats, not 1,101 unique characters/vehicles. These stylized archive packs are not
imported into Unreal or the browser and have no runtime NPC/traffic integration.

The native MetaHuman acquisition pipeline now waits for Unreal's actual assembly-ready gate
instead of treating the texture flag as completion. This fixes a reproduced callback teardown
race. It retains pending editor objects on failure, runs one editor at a time, and cold-loads
each runtime Blueprint before installing the strict ten-MetaHuman roster. Quality remains
optimized/high; no mannequin is substituted. Native source content, staging, DDC and logs
remain on HP.

At the last connected check, Bo's cloud rigging and textures had completed and native face
mesh assembly was running. No new preset had yet passed cold-load verification. The Mac
subsequently restarted. During the November 6 validation, HP was disconnected and macOS
reported no external physical disk; the queue could not resume or verify later on-drive
progress. Native acquisition is therefore **pending**, not reported complete. Reconnect HP,
inspect its saved queue/logs and resume the batch before claiming additional usable presets.
