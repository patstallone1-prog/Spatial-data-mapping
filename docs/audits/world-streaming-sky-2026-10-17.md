# World streaming, sky and source integration

## Release scope

The eight existing built regions remain the coverage boundary. The hierarchical
tile tree supplies distant roads/buildings; nearby windows use the existing full
detail renderer, not decimated copies. Default app startup builds a 700 m square;
subsequent handoffs build a 440 m square with nearby source-cell prefetch. A
teleport prioritizes its destination. The previous working window is retained
until the new streets and ground are ready; failures retain the old window.
Only one replacement is built at a time, with the latest requested destination
superseding stale queued destinations. No region/page navigation is necessary.

The in-memory source-cell cache has four concurrent fetches and a 48 MiB decoded
JSON allowance. This is **not** a total process/GPU memory guarantee. Immutable
data must still be fetched after a fresh launch. The service worker remains a
minimal app-shell cache; this does not reintroduce stale persistent world caches.
The global address index contains 54,138 addresses across eight regions.
Far buildings now have lightweight window/frame textures with unchanged triangles.

## Verification evidence

- Local SF startup at `-122.429,37.798`, explicit 440 m square: 5.2–6.6 s
  to the streets renderer's build log on this M4; ground completes separately.
- Search SF → **225 East Santa Clara Street, San Jose**: detailed handoff ready
  in **4.1 s**, no page navigation. Destination telemetry: 45 municipal sidewalk
  polygons, 29 municipal curb-colour records, 44.2 MiB retained cells.
- SF → **1 Frank H. Ogawa Plaza, Oakland**: **19.1 s** detail handoff,
  47.4 MiB retained cells. First-person view has no duplicate guest avatar.
  Coarse tiles remain available during refinement; full detail is not instantaneous.
- These are individual localhost checks, not production/mobile percentile SLAs.
  Network speed, city density and retained cell sizes affect subsequent timings.
- The former guest build log incorrectly printed time since page load; that
  number was not build duration. Timers now measure each build/handoff explicitly.
- A browser-specific fetch receiver bug was caught in the visual pass. Native
  `fetch` now keeps its proper receiver; a regression test reproduces the failure.
- Guest worlds must never create a second visible avatar. The first-person
  smoke check caught and corrected guest initialization re-enabling that avatar.
- Missing `fps` query parameters no longer coerce `null` to unlimited rendering;
  the intended default or saved frame cap is respected.
- Sky controls exercised live SF time, solar-noon preview, cloud and rain presets.
  Solar tests check unit vectors, day/night and PST/PDT transitions.
- Epic runtime compiled on the installed UE 5.8/Mac SDK 26.2. All four required
  `Kerbside.World` automation tests passed, zero failures/warnings. The automated
  native check used NullRHI; it is not a graphical/performance acceptance result.

## Sky consumers

Unreal uses Epic's **Celestial Vault / Day Sequence**: sun, moon, stars, atmosphere,
volumetric clouds and existing world shadows. A one-second wall clock supplies
America/Los_Angeles time with date-correct DST, rather than accelerated game time.
Cloud/fog presets are visual selections, **not observed live weather**. Native rain
currently means storm cloud/fog, not a precipitation-particle asset.

The local native pilot map was duplicated from `City_pilot_exact_v1` into
`City_sky_20261017`; the original and its geometry were preserved. The managed
startup map now points at the sky revision. This is not an all-region native
export or a newly packaged native application.

The installed web app cannot execute Unreal plugins. It uses the pinned upstream
Three.js Sky and SunCalc libraries, with simple cloud/rain visual layers and SF
solar time. Settings expose live/dawn/noon/dusk/night and sunny/partly-cloudy/cloudy/
rain previews. Cubemap lighting updates only on changes or every five minutes.
Libraries, checksums and licenses are in `vendor/manifest.json`.

## Existing-region sources

`integrated-source-validation.json` records the consumption and limitations.
San Jose's 1,255 sidewalk polygons enter the pavement/hard-ground mask, clipped
against carriageways by the existing surface renderer. The 476 recognised curb
colour records paint the drawn curb geometry, not new floating bands or inferred
legal parking rules. Hole-bearing polygons are rejected rather than filled.

Oakland's 2,558 historical parking references, Palo Alto's 1,441 mixed-method road
edges, 32 San Jose survey controls and 20 project lines remain typed review/
validation references. Projects are not as-built geometry; unknown control datums
are not registration anchors; 2015 parking is not current regulation. Full source
geometry remains in the checksummed acquisition store, not duplicated in public
reference records. Private contacts are excluded from served records.

The Palo Alto diagnostic supports 523/1,441 tentative parallel-edge comparisons:
median 0.973 m, P90 2.393 m disagreement against nominal road widths. These are
**not surveyed-curb accuracy figures** and do not justify moving canonical curbs.
Four newly downloaded lidar probes were tested against already-served terrain
from their corresponding collections. All probe ground returns had grid support;
relative-shape diagnostics and unresolved vertical offsets are reported explicitly.
They are not independent accuracy benchmarks. No canonical geometry was changed.
The earlier photo/lidar accuracy audit and its 7.95 cm development result are unchanged.

## Houses and future gaps

The HP700 supervisor was observed running. It pauses below its storage reserve or
at the existing 30% battery threshold; no power policy was weakened. Publication
is an explicit accepted-record snapshot, not automatic promotion of worker proposals.
`house-publication-snapshot.json`: **4,052 published image-derived visual fits,
four net additions**. Existing production material/trim refinements are preserved.
These are not dense scanned buildings or measured collision. No raw photos are published.

Twelve planning envelopes connect SF, the Peninsula and East/South Bay. Subtracting
existing coverage and overlaps yields **337 dormant jobs** at up to 2.5 km,
covering 1,578.5 km² of planning envelope including water/nature. These are not new
measured regions or exact jurisdiction boundaries. Profiles reuse established
bounded OSM/terrain/lidar/imagery adapters; unverified municipal endpoints require
discovery. `scripts/ingest_gap_region.py JOB` is dry-run by default. Actual intake
requires explicit `--allow-intake`. No gap-region ingestion was started.

## Reproduction / ownership

- Renderer source: `scripts/build_sf_corridor_3d.py`; regenerate only app viewers
  using `tools/build_app_worlds.py`. Do not edit generated regional pages separately.
- Source integration: `scripts/integrate_municipal_evidence.py`, then
  `scripts/audit_integrated_sources.py` (requires the retained private acquisitions).
- House publication: `tools/publish_house_snapshot.py --houses PATH`; merge from
  committed production fits, preserving all existing IDs/refinements.
- Native SDK bridge: `tools/unreal/build_macos.py --project PROJECT.uproject
  --engine ENGINE --xcode Xcode.app`; optional `--check-only`. Handles external
  paths with spaces without changing global xcode-select or Epic engine files.
- New native worlds: `tools/unreal/setup_world.py`. Existing managed pilot:
  `tools/unreal/update_environment.py`, which refuses to overwrite an existing
  sky revision or change an unrelated startup map.
- Graphify guides code navigation and is updated after implementation. Deployment
  remains blocked on the existing ruff, pytest and render-baseline gates.

Upstream references: [Epic Celestial Vault](https://dev.epicgames.com/documentation/en-us/unreal-engine/celestial-vault-plugin-for-unreal-engine),
[Three.js Sky](https://threejs.org/docs/pages/Sky.html),
[SunCalc](https://github.com/mourner/suncalc/tree/v1.9.0).
