# Installed-app cache upgrade and facade fitting — 2026-10-08

## Release scope

This pass builds on the returning-visitor cache patch and frontage filter. It does
not restore deleted home scans or modify canonical footprints, heights, collision,
road paint, or other agents' worktrees. The app renderer remains the stable consumer.

## Installed-app state

The service worker retains only seven shell assets. Mutable world data, detail
shards, imagery, tiles and materials are fetched rather than placed in that cache.
Activation removes recognized obsolete Kerbside world caches; unrelated caches,
capture IndexedDB and user settings are preserved. Offline shell access remains,
but an uncached world needs connectivity. A read-only message diagnostic reports
cache policy/version and obsolete-cache count.

Shell registration bypasses HTTP caching for worker updates. Startup, foreground,
pageshow and a throttled five-minute check discover updates. Taking control does
not reload a running map. An explicit “Update ready — reopen map” button lets the
user reload when convenient. Network/update-check failures do not force reloads.

The installed-app restart reported on two Macs has not been reproduced or proven
to originate in caching. These changes remove a confirmed stale-world-cache risk;
they do not certify that WebKit memory termination or every other restart cause
is fixed. Closed apps on another Mac cannot be remotely updated: open online and
reopen once if the update button appears. Local browser loading and explicit
update interaction were checked; the actual affected installed Mac apps still
need an observational test. A browser-injected MutationObserver error was observed;
there is no MutationObserver in the app/template renderer source.

## Facade engine, not a promoted photogrammetric mesh

`src/smc/facades/fit.py` produces private visual specifications from rectified
front photographs and semantic labels. It combines opening masks with the
existing opening detector, extracts aspect ratio and visible pane bars, clips
openings below the roof, and records image-derived wall colour. Colour is not
calibrated albedo; material labels currently come from the existing assignment
pipeline, not a newly trained material recognizer.

Height/storey constraints are explicit. Implausible or inconsistent combinations
produce conflicts rather than altering canonical geometry. Ground/curb controls
must identify a shared relative datum and their source. This is an interface for
surveyed controls, not automatic georeferencing of arbitrary curb heights.

Entrance controls support short, long and overhang recesses. A recess must refer
to its door and supporting evidence. Rise determines riser count, the landing is
four 0.30 m treads deep, and unsupported or insufficient-depth stairs are not
renderable. A “long” label alone never establishes a second-floor entrance.
Automatic image-depth/recess classification and live door/garage fitting remain
unfinished; these records do not create new live stairs.

The renderer can consume explicitly reviewed visual window layouts, pane designs,
colour and material. Front/side distinction, edge reversal (including pane bars),
roof clearances and unchanged footprint/height checks guard application. Other
sides keep the previous inferred layout. An empty reviewed sidecar preserves the
existing world when no fit qualifies. No photographs are published by the matcher.

### Initial real-photo audit

The first matching cycle produced 25 building specifications. Comparisons are
private source-photo versus render-spec diagrams, not a measured 3D benchmark.

- 550–556 Union Street: frontage crop displaced and cut at the roof/right edge;
  fire escape fragments became false windows; sampled colour differs from the
  beige wall. Not accepted.
- 2116–2120 Leavenworth Street: crop largely contains a bay, not the complete
  entrance/frontage. Not accepted.
- 700 Filbert Street: roof cropped and ground obscured by bus/trees. Not accepted.
- 2299 Lombard Street and 420 Filbert Street: comparison UI confirms partial
  frontage and proposal errors, reinforcing the need for full-front review.

No fit has passed the image-bound full-front, opening, material, metric-alignment
and rights review gates. The public facade-fit sidecar is deliberately empty.
Position uncertainty is at least 0.50 m on current prior-based proposals; accuracy
within a few inches is not established. Next work is pose/crop refinement,
building-identity/full-front verification, privacy review, surveyed shared-datum
controls, and approved door/garage/recess integration before promotion.

## Retention and ongoing jobs

Rejected scratch crops, context previews, masks and unshared canonical decoded
pixel blobs are removed. Accepted/shared evidence is retained; source catalogues,
aliases, licences, checksums and rejection reasons are untouched. One cleanup of
the live output alone removed 76 files / 609,019,480 bytes, plus additional pilot
cleanup. Local deleted pixels require redownload to recover.

The filter advances to unseen views rather than repeatedly screening the same
24. Rejections are pruned after every batch. Both filter and matcher lock their
own output and stop at a checkpoint if their implementation changes. The matcher
retries recoverable cycle failures, writes private status/comparison artifacts,
and never automatically publishes. These are local jobs: sleeping/restarting this
Mac stops progress; they are not cloud services.

## Regression evidence

94 focused tests pass: service-worker behavior and upgrade paths, frontage policy,
retention/shared-blob safety, storey/entrance constraints, appearance extraction,
reviewed-fit selection/footprint staleness/pane mirroring, eight generated consumer
templates, light-build behavior, home shell/windows/openings, walking/interiors.
Ruff and whitespace checks pass. Complete CI and render-baseline checks remain
mandatory for merge and Vercel promotion. Existing graph is refreshed AST-only.

## Local inspection

Private matching output: `build/facade-match/index.html` and `status.json`.
Filter output: `build/frontage-live/review/index.html` and `status.json`.
Neither private evidence nor model weights are in the deployable `docs/` tree.

## Follow-up: visible stairs, detail objects and certainty

The subsequent request tightens the promotion condition: deploy only after
correct, higher-accuracy photo rendering is verified. **That condition has not
passed; PR 32 must remain unmerged.** The earlier, independently green cache PR
31 was merged before this follow-up. Production now serves shell-only worker
`6fae9c7cc54f4cc9`; the foreground-update button and facade work are not live yet.

Added a pinned [Grounding DINO tiny](https://huggingface.co/IDEA-Research/grounding-dino-tiny)
adapter rather than another homemade semantic detector. Revision and model-file
SHA256 are recorded in `data/benchmarks/facade-detail-audit-v1.json`, alongside
three source hashes/locators and explicit failed visual findings. This is a
fault audit, **not** a held-out metric benchmark. Its detector scores are not
probabilities of house correctness. Union's fire escape was localized, but a
garage was incorrectly labelled stairs; Filbert windows were missed; Leavenworth
cornices were labelled canopies. No model proposal alone is rendered.

Entrance fitting now requires image-bound, reviewed visible stairs. A visible
door can have five/six observed risers in a short recess. Hidden-door long-flight
inference requires a height/levels-constrained storey bottom; partial visible
step counts cannot compress a full-storey rise into five steps. Its four-tread
landing aligns with the inferred threshold. Such stairs remain proposed visual
specifications, not new live collision or automatic physical house entries.

Reviewed detail controls can represent balconies/fire escapes, observed colour,
material class and vertical-bar/lattice/solid rail style. Renderer plumbing draws
their platforms at controlled or explicitly inferred storey levels and batches
the geometry; unreviewed, wrong-image, invalid and above-roof records are rejected.
Exact ornate rail patterns and measured protrusion depth are **not** recovered.
Canonical collision remains separate, and a real-record 3D visual audit is still
required before these details can be promoted.

Every selectable building, including unaddressed buildings, exposes a categorical
certainty description: inferred versus reviewed photo-front, appearance basis,
height source, inferred unseen sides, and whether inch-scale accuracy is verified.
It does not manufacture a numerical certainty percentage.

Found and corrected mirrored audit orientation caused by clockwise frontage
sampling. The new selection path normalizes street-readable endpoint order and
records shared-terrain camera/frontage elevation differences. Raw images are not
mirrored or duplicated. Three source-pixel reprojections were inspected: text
orientation improved, but cropped roofs/fronts persisted. Camera height above
ground remains estimated; the 2 m terrain grid is not independent curb truth.
The facade matcher therefore remains private with zero promoted fits.

Current focused result: **169 tests pass**, including new visible-stair, hidden
entry, six-riser recess, material/rail parameter, photo-detail renderer, certainty,
shared-terrain and endpoint-orientation checks. The first full CI run had 1,182
passing tests and one obsolete assertion demanding `force-cache`; that assertion
now requires revalidation while retaining per-visit promise memoization. CI is
rerun on the new commit and remains a separate gate from failed photo accuracy.
